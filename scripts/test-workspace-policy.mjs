import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWorkspacePolicy } from './check-workspace-policy.mjs';

const policy = {
	writableRoots: ['plugins/'],
	hiddenPaths: ['graders/', 'scripts/', '.github/', 'docs/'],
};

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function writeFile(root, relativePath, content = '') {
	const absolutePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content);
}

function makeRepo() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-policy-'));
	git(root, ['init', '-q']);
	git(root, ['config', 'user.email', 'policy@example.test']);
	git(root, ['config', 'user.name', 'Policy Test']);
	writeFile(root, 'plugins/.gitkeep', '');
	writeFile(root, 'scripts/locked.php', '<?php // locked');
	writeFile(root, 'graders/hidden.php', '<?php // hidden');
	writeFile(root, 'README.md', '# fixture\n');
	git(root, ['add', '.']);
	git(root, ['commit', '-qm', 'initial']);
	return root;
}

function runCase(name, mutate, expectPassed, expectedReason = null) {
	const root = makeRepo();
	mutate(root);
	const result = checkWorkspacePolicy({ workspaceRoot: root, policy });
	const reasons = result.violations.map((violation) => violation.reason);

	if (result.passed !== expectPassed) {
		throw new Error(`${name}: expected passed=${expectPassed}, got ${JSON.stringify(result)}`);
	}

	if (expectedReason && !reasons.includes(expectedReason)) {
		throw new Error(`${name}: expected reason ${expectedReason}, got ${JSON.stringify(result)}`);
	}

	console.log(`${name}: ${result.passed ? 'pass' : `fail (${reasons.join(', ')})`}`);
}

runCase('allowed plugin write', (root) => {
	writeFile(root, 'plugins/solution.php', '<?php // ok');
}, true);

runCase('hidden path write', (root) => {
	writeFile(root, 'scripts/changed.php', '<?php // hidden');
}, false, 'hidden_path');

runCase('repo root write', (root) => {
	writeFile(root, 'README.md', '# changed\n');
}, false, 'non_writable_path');

runCase('symlink to hidden path', (root) => {
	fs.symlinkSync('../graders/hidden.php', path.join(root, 'plugins/grader-link.php'));
}, false, 'symlink');

runCase('symlink outside workspace', (root) => {
	const outside = path.join(os.tmpdir(), `wp-gym-policy-outside-${process.pid}.php`);
	fs.writeFileSync(outside, '<?php // outside');
	fs.symlinkSync(outside, path.join(root, 'plugins/outside-link.php'));
}, false, 'symlink');

runCase('hidden delete', (root) => {
	fs.unlinkSync(path.join(root, 'scripts/locked.php'));
}, false, 'hidden_path');

runCase('hidden rename into writable root', (root) => {
	git(root, ['mv', 'scripts/locked.php', 'plugins/locked.php']);
}, false, 'hidden_path');

{
	const root = makeRepo();
	writeFile(root, 'plugins/solution.php', '<?php // ok');
	const result = checkWorkspacePolicy({
		workspaceRoot: root,
		policy: {
			...policy,
			writableRoots: [],
		},
	});
	const reasons = result.violations.map((violation) => violation.reason);
	if (result.passed || !reasons.includes('no_writable_roots')) {
		throw new Error(`empty writable roots: expected no_writable_roots, got ${JSON.stringify(result)}`);
	}
	console.log(`empty writable roots: fail (${reasons.join(', ')})`);
}

{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-policy-no-git-'));
	fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
	const result = checkWorkspacePolicy({ workspaceRoot: root, policy });
	const reasons = result.violations.map((violation) => violation.reason);
	if (result.passed || !reasons.includes('missing_git_root')) {
		throw new Error(`missing git root: expected missing_git_root, got ${JSON.stringify(result)}`);
	}
	console.log(`missing git root: fail (${reasons.join(', ')})`);
}
