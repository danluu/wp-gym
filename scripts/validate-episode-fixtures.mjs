import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'episode-results');
const validRoot = path.join(fixtureRoot, 'valid');
const invalidRoot = path.join(fixtureRoot, 'invalid');
const schemaPath = path.join(root, 'schemas', 'episode-result.schema.json');
const hashPattern = /^sha256:[0-9a-f]{64}$/;
const graderTools = new Set(['php_grader']);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function normalizePath(value) {
	return value.replace(/\\/g, '/');
}

function resolveFrom(baseFile, candidate) {
	return normalizePath(path.relative(root, path.resolve(root, path.dirname(baseFile), candidate)));
}

function sha256(content) {
	return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

async function fileSha256(relativePath) {
	return sha256(await readFile(path.join(root, relativePath)));
}

async function listJsonFiles(dir, relativeDir) {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listJsonFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(normalizePath(relativePath));
		}
	}

	return files.sort();
}

async function scenarioFiles(dir = path.join(root, 'scenarios'), relativeDir = 'scenarios') {
	return listJsonFiles(dir, relativeDir);
}

async function loadScenarios() {
	const scenarios = new Map();

	for (const file of await scenarioFiles()) {
		const scenario = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		scenarios.set(scenario.id, {
			file,
			manifest: scenario,
			promptFile: resolveFrom(file, scenario.prompt_file),
			graderFile: resolveFrom(file, scenario.grader_file),
		});
	}

	return scenarios;
}

function assertHash(value, label) {
	assert(typeof value === 'string' && hashPattern.test(value), `${label} must match sha256:<64 lowercase hex>`);
}

function assertArrayEqual(actual, expected, label) {
	assert(Array.isArray(actual), `${label} must be an array`);
	assert(Array.isArray(expected), `${label} expected value must be an array`);
	assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${label} must match scenario manifest; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
	);
}

function localArtifactPaths(artifacts) {
	const paths = [];
	if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
		return paths;
	}

	for (const value of Object.values(artifacts)) {
		if (typeof value !== 'string' || value.length === 0) {
			continue;
		}
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
			continue;
		}
		paths.push(value);
	}

	return paths;
}

function expectedFailureReasons(checks) {
	return [
		...new Set(
			checks
				.filter((check) => check && typeof check === 'object' && check.passed === false)
				.map((check) => check.failure_reason || check.id)
				.filter(Boolean)
		),
	].sort();
}

async function validateEpisode(file, episode, scenarios, validateSchema) {
	const valid = validateSchema(episode);
	if (!valid) {
		throw new Error(`${file} schema errors: ${validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
	}

	const scenario = scenarios.get(episode.scenario.id);
	assert(scenario, `${file} references unknown scenario id: ${episode.scenario.id}`);

	assertHash(episode.scenario.manifest_sha256, `${file} scenario.manifest_sha256`);
	assertHash(episode.scenario.prompt_sha256, `${file} scenario.prompt_sha256`);
	assertHash(episode.scenario.grader_sha256, `${file} scenario.grader_sha256`);
	assertHash(episode.scenario.reset_hash, `${file} scenario.reset_hash`);
	assert(episode.scenario.manifest_sha256 === await fileSha256(scenario.file), `${file} scenario.manifest_sha256 does not match ${scenario.file}`);
	assert(episode.scenario.prompt_sha256 === await fileSha256(scenario.promptFile), `${file} scenario.prompt_sha256 does not match ${scenario.promptFile}`);
	assert(episode.scenario.grader_sha256 === await fileSha256(scenario.graderFile), `${file} scenario.grader_sha256 does not match ${scenario.graderFile}`);

	const environment = scenario.manifest.environment;
	assert(episode.environment.action_mode === environment.action_mode, `${file} environment.action_mode must match scenario manifest`);
	assertArrayEqual(episode.environment.observation_channels, environment.observation_channels, `${file} environment.observation_channels`);
	assertArrayEqual(episode.environment.allowed_tools, environment.allowed_tools, `${file} environment.allowed_tools`);
	assertArrayEqual(episode.environment.writable_roots, environment.writable_roots, `${file} environment.writable_roots`);
	assertArrayEqual(episode.environment.hidden_paths, environment.hidden_paths, `${file} environment.hidden_paths`);

	const [minReward, maxReward] = scenario.manifest.reward_spec.reward_range;
	assert(episode.result.reward >= minReward && episode.result.reward <= maxReward, `${file} result.reward must be within scenario reward_range`);
	assert(episode.result.grade.max_score > 0, `${file} result.grade.max_score must be positive`);
	assert(episode.result.grade.score >= 0 && episode.result.grade.score <= episode.result.grade.max_score, `${file} result.grade.score must be within grade bounds`);

	const normalizedReward = Number((episode.result.grade.score / episode.result.grade.max_score).toFixed(6));
	assert(Math.abs(episode.result.reward - normalizedReward) < 0.000001, `${file} result.reward must equal normalized grade score`);
	assert(
		episode.result.success === (episode.result.reward >= scenario.manifest.reward_spec.success_threshold),
		`${file} result.success must match reward_spec.success_threshold`
	);

	const failedReasons = expectedFailureReasons(episode.result.grade.checks);
	assertArrayEqual([...episode.result.failure_reasons].sort(), failedReasons, `${file} result.failure_reasons`);

	for (const artifactPath of localArtifactPaths(episode.artifacts)) {
		assert(existsSync(path.join(root, artifactPath)), `${file} artifact path does not exist: ${artifactPath}`);
	}

	episode.steps.forEach((step, index) => {
		assert(step.index === index, `${file} steps[${index}].index must equal its position`);
		assert(step.observation.reset_hash === episode.scenario.reset_hash, `${file} steps[${index}].observation.reset_hash must match scenario.reset_hash`);
		assert(step.reward >= minReward && step.reward <= maxReward, `${file} steps[${index}].reward must be within scenario reward_range`);

		if (step.actor === 'agent') {
			assert(episode.environment.allowed_tools.includes(step.action.tool), `${file} steps[${index}].action.tool is not allowed: ${step.action.tool}`);
		} else if (step.actor === 'grader') {
			assert(graderTools.has(step.action.tool), `${file} steps[${index}].grader action.tool is not recognized: ${step.action.tool}`);
		}

		if (step.action.args_sha256 !== null && step.action.args_sha256 !== undefined) {
			assertHash(step.action.args_sha256, `${file} steps[${index}].action.args_sha256`);
		}
		if (step.result.workspace_diff_sha256 !== null && step.result.workspace_diff_sha256 !== undefined) {
			assertHash(step.result.workspace_diff_sha256, `${file} steps[${index}].result.workspace_diff_sha256`);
		}
		for (const artifactPath of localArtifactPaths(step.artifacts)) {
			assert(existsSync(path.join(root, artifactPath)), `${file} steps[${index}] artifact path does not exist: ${artifactPath}`);
		}
	});
}

async function main() {
	const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	const validateSchema = ajv.compile(schema);
	const scenarios = await loadScenarios();
	const validFiles = await listJsonFiles(validRoot, 'fixtures/episode-results/valid');
	const invalidFiles = await listJsonFiles(invalidRoot, 'fixtures/episode-results/invalid');

	assert(validFiles.length > 0, 'Expected at least one valid episode result fixture.');
	assert(invalidFiles.length > 0, 'Expected at least one invalid episode result fixture.');

	for (const file of validFiles) {
		await validateEpisode(file, JSON.parse(await readFile(path.join(root, file), 'utf8')), scenarios, validateSchema);
	}

	for (const file of invalidFiles) {
		try {
			await validateEpisode(file, JSON.parse(await readFile(path.join(root, file), 'utf8')), scenarios, validateSchema);
		} catch (error) {
			console.log(`Rejected invalid fixture ${file}: ${error.message}`);
			continue;
		}
		throw new Error(`${file} was expected to be invalid but passed validation`);
	}

	console.log(`Validated ${validFiles.length} valid and ${invalidFiles.length} invalid episode result fixture(s).`);
}

await main();
