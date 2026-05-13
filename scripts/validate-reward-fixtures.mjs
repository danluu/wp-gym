import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'reward-hacking');

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function listFixtureFiles(dir = fixtureRoot, relativeDir = 'fixtures/reward-hacking') {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			files.push(...await listFixtureFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

function validateFixture(file, fixture) {
	for (const field of ['id', 'scenario_id', 'grader_file', 'type', 'expected_result', 'content_file']) {
		assert(typeof fixture[field] === 'string' && fixture[field].length > 0, `${file} missing ${field}`);
	}

	assert(fixture.type === 'adversarial_negative_fixture', `${file} type must be adversarial_negative_fixture`);
	assert(fixture.expected_result === 'fail', `${file} expected_result must be fail`);
	assert(Array.isArray(fixture.expected_failure_reasons) && fixture.expected_failure_reasons.length > 0, `${file} must declare expected_failure_reasons`);
	assert(existsSync(path.join(root, fixture.grader_file)), `${file} grader_file does not exist: ${fixture.grader_file}`);
	assert(existsSync(path.join(root, fixture.content_file)), `${file} content_file does not exist: ${fixture.content_file}`);
}

function runFixture(file, fixture) {
	const result = spawnSync(
		'php',
		['scripts/run-block-markup-fixture.php', path.join(root, file), root],
		{ cwd: root, encoding: 'utf8' }
	);

	assert(result.status === 0, `${file} fixture execution failed:\n${result.stdout}${result.stderr}`);

	let grade;
	try {
		grade = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`${file} fixture runner did not emit JSON: ${error.message}\n${result.stdout}${result.stderr}`);
	}

	if (fixture.expected_result === 'fail') {
		assert(grade.success === false, `${file} expected fixture to fail, got success=true`);
		assert(Number(grade.reward) < 1, `${file} expected reward below 1, got ${grade.reward}`);
		for (const reason of fixture.expected_failure_reasons) {
			assert(
				Array.isArray(grade.failure_reasons) && grade.failure_reasons.includes(reason),
				`${file} expected failure reason ${reason}, got ${JSON.stringify(grade.failure_reasons || [])}`
			);
		}
	}
}

const files = await listFixtureFiles();
assert(files.length > 0, 'Expected at least one reward-hacking fixture.');

for (const file of files) {
	const fixture = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	validateFixture(file, fixture);
	runFixture(file, fixture);
}

console.log(`Validated and executed ${files.length} reward-hacking fixture(s).`);
