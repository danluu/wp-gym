import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'episode-results');
const requiredTopLevelFields = [
	'schema_version',
	'scenario',
	'environment',
	'steps',
	'result',
	'provenance',
	'artifacts',
];

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function assertObject(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertString(value, label) {
	assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
}

function assertStringArray(value, label) {
	assert(Array.isArray(value), `${label} must be an array`);
	for (const entry of value) {
		assertString(entry, `${label} entry`);
	}
}

async function listFixtureFiles() {
	if (!existsSync(fixtureRoot)) {
		return [];
	}

	const entries = await readdir(fixtureRoot, { withFileTypes: true });

	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => path.join('fixtures', 'episode-results', entry.name))
		.sort();
}

function validateStep(file, step, index) {
	assertObject(step, `${file} steps[${index}]`);
	assert(step.index === index, `${file} steps[${index}].index must match its array position`);
	assertString(step.actor, `${file} steps[${index}].actor`);
	assertObject(step.observation, `${file} steps[${index}].observation`);
	assertString(step.observation.reset_hash, `${file} steps[${index}].observation.reset_hash`);
	assertObject(step.action, `${file} steps[${index}].action`);
	assertString(step.action.tool, `${file} steps[${index}].action.tool`);
	assertObject(step.result, `${file} steps[${index}].result`);
	assertString(step.result.status, `${file} steps[${index}].result.status`);
	assert(typeof step.reward === 'number', `${file} steps[${index}].reward must be a number`);
	assertStringArray(step.failure_reasons, `${file} steps[${index}].failure_reasons`);
	assertObject(step.artifacts, `${file} steps[${index}].artifacts`);
	assertObject(step.provenance, `${file} steps[${index}].provenance`);
}

function validateEpisode(file, episode) {
	assertObject(episode, file);

	for (const field of requiredTopLevelFields) {
		assert(Object.hasOwn(episode, field), `${file} missing required top-level field: ${field}`);
	}

	assert(Number.isInteger(episode.schema_version) && episode.schema_version > 0, `${file} schema_version must be a positive integer`);
	assertObject(episode.scenario, `${file} scenario`);
	assertString(episode.scenario.id, `${file} scenario.id`);
	assertString(episode.scenario.manifest_sha256, `${file} scenario.manifest_sha256`);
	assertString(episode.scenario.prompt_sha256, `${file} scenario.prompt_sha256`);
	assertString(episode.scenario.grader_sha256, `${file} scenario.grader_sha256`);
	assertString(episode.scenario.reset_hash, `${file} scenario.reset_hash`);

	assertObject(episode.environment, `${file} environment`);
	assertString(episode.environment.action_mode, `${file} environment.action_mode`);
	assertStringArray(episode.environment.observation_channels, `${file} environment.observation_channels`);
	assertStringArray(episode.environment.allowed_tools, `${file} environment.allowed_tools`);

	assert(Array.isArray(episode.steps) && episode.steps.length > 0, `${file} steps must include at least one step`);
	episode.steps.forEach((step, index) => validateStep(file, step, index));

	assertObject(episode.result, `${file} result`);
	assert(typeof episode.result.success === 'boolean', `${file} result.success must be a boolean`);
	assert(typeof episode.result.reward === 'number', `${file} result.reward must be a number`);
	assert(typeof episode.result.terminated === 'boolean', `${file} result.terminated must be a boolean`);
	assert(typeof episode.result.truncated === 'boolean', `${file} result.truncated must be a boolean`);
	assert(
		episode.result.truncated === false || typeof episode.result.truncation_reason === 'string',
		`${file} result.truncated=true must include truncation_reason`
	);
	assertStringArray(episode.result.failure_reasons, `${file} result.failure_reasons`);
	assertObject(episode.result.grade, `${file} result.grade`);
	assert(Array.isArray(episode.result.grade.checks), `${file} result.grade.checks must be an array`);

	assertObject(episode.provenance, `${file} provenance`);
	for (const field of ['wp_gym_ref', 'runner_ref', 'wordpress_version', 'php_version']) {
		assertString(episode.provenance[field], `${file} provenance.${field}`);
	}
	assertObject(episode.artifacts, `${file} artifacts`);
}

const files = await listFixtureFiles();
assert(files.length > 0, 'Expected at least one episode result fixture.');

for (const file of files) {
	validateEpisode(file, JSON.parse(await readFile(path.join(root, file), 'utf8')));
}

console.log(`Validated ${files.length} episode result fixture(s).`);
