import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const files = await listFixtureFiles();
assert(files.length > 0, 'Expected at least one reward-hacking fixture.');

for (const file of files) {
	validateFixture(file, JSON.parse(await readFile(path.join(root, file), 'utf8')));
}

console.log(`Validated ${files.length} reward-hacking fixture(s).`);
