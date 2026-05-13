import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeRelativePath(value, label = 'path') {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}

	const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
	if (
		normalized === '' ||
		normalized.startsWith('/') ||
		path.isAbsolute(normalized) ||
		normalized.split('/').includes('..')
	) {
		throw new Error(`${label} must be repo-relative without traversal: ${value}`);
	}

	return normalized;
}

function pathHasPrefix(candidate, prefix) {
	return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function parseGitStatusZ(output) {
	const fields = output.split('\0').filter(Boolean);
	const entries = [];

	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];
		const status = field.slice(0, 2);
		const firstPath = field.slice(3);
		const paths = [firstPath];

		if ((status.includes('R') || status.includes('C')) && index + 1 < fields.length) {
			paths.push(fields[index + 1]);
			index += 1;
		}

		for (const rawPath of paths) {
			if (rawPath) {
				entries.push({
					status,
					path: normalizeRelativePath(rawPath, 'git status path'),
				});
			}
		}
	}

	return entries;
}

function gitStatus(workspaceRoot) {
	const result = spawnSync(
		'git',
		['-C', workspaceRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
		{ encoding: 'utf8' }
	);

	if (result.status !== 0) {
		return {
			ok: false,
			error: `${result.stderr || result.stdout || 'git status failed'}`.trim(),
			entries: [],
		};
	}

	return {
		ok: true,
		error: null,
		entries: parseGitStatusZ(result.stdout),
	};
}

function realpathIfExists(absolutePath) {
	try {
		return fs.realpathSync(absolutePath);
	} catch {
		return null;
	}
}

function isContainedBy(candidate, root) {
	const relative = path.relative(root, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultPolicyFromManifest(manifest) {
	const environment = manifest?.environment || {};
	return {
		writableRoots: environment.writable_roots || [],
		hiddenPaths: environment.hidden_paths || [],
	};
}

export function checkWorkspacePolicy({ workspaceRoot, manifest = null, policy = null }) {
	const violations = [];
	const root = path.resolve(workspaceRoot);
	const rootRealpath = realpathIfExists(root);

	if (!rootRealpath) {
		return {
			passed: false,
			violations: [{ path: '.', reason: 'missing_workspace_root' }],
		};
	}

	if (!fs.existsSync(path.join(rootRealpath, '.git'))) {
		return {
			passed: false,
			violations: [{ path: '.git', reason: 'missing_git_root' }],
		};
	}

	const effectivePolicy = policy || defaultPolicyFromManifest(manifest);
	const writableRoots = (effectivePolicy.writableRoots || []).map((entry) =>
		normalizeRelativePath(entry, 'writable root')
	);
	const hiddenPaths = (effectivePolicy.hiddenPaths || []).map((entry) =>
		normalizeRelativePath(entry, 'hidden path')
	);

	if (writableRoots.length === 0) {
		violations.push({ path: '.', reason: 'no_writable_roots' });
	}

	const writableRootRealpaths = [];
	for (const writableRoot of writableRoots) {
		const absolute = path.join(rootRealpath, writableRoot);
		const realpath = realpathIfExists(absolute);
		if (!realpath) {
			violations.push({ path: writableRoot, reason: 'missing_writable_root' });
			continue;
		}
		writableRootRealpaths.push({ relative: writableRoot, realpath });
	}

	const status = gitStatus(rootRealpath);
	if (!status.ok) {
		return {
			passed: false,
			violations: [{ path: '.', reason: 'git_status_failed', detail: status.error }],
		};
	}

	for (const entry of status.entries) {
		const relativePath = entry.path;
		const absolutePath = path.join(rootRealpath, relativePath);

		if (hiddenPaths.some((hiddenPath) => pathHasPrefix(relativePath, hiddenPath))) {
			violations.push({ path: relativePath, reason: 'hidden_path', status: entry.status });
		}

		if (!writableRoots.some((writableRoot) => pathHasPrefix(relativePath, writableRoot))) {
			violations.push({ path: relativePath, reason: 'non_writable_path', status: entry.status });
		}

		if (fs.existsSync(absolutePath)) {
			const lstat = fs.lstatSync(absolutePath);
			if (lstat.isSymbolicLink()) {
				violations.push({ path: relativePath, reason: 'symlink', status: entry.status });
				continue;
			}

			if (!lstat.isFile() && !lstat.isDirectory()) {
				violations.push({ path: relativePath, reason: 'non_regular_file', status: entry.status });
				continue;
			}

			if (lstat.isFile()) {
				const realpath = fs.realpathSync(absolutePath);
				if (!isContainedBy(realpath, rootRealpath)) {
					violations.push({ path: relativePath, reason: 'outside_workspace', status: entry.status });
				}

				if (!writableRootRealpaths.some((rootPath) => isContainedBy(realpath, rootPath.realpath))) {
					violations.push({ path: relativePath, reason: 'outside_writable_root', status: entry.status });
				}
			}
		}
	}

	return {
		passed: violations.length === 0,
		violations,
	};
}

function parseArgs(argv) {
	const args = {
		workspaceRoot: '',
		manifestPath: '',
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--workspace') {
			args.workspaceRoot = argv[++index] || '';
		} else if (arg === '--manifest') {
			args.manifestPath = argv[++index] || '';
		} else if (arg === '--json') {
			args.json = true;
		}
	}

	if (!args.workspaceRoot || !args.manifestPath) {
		throw new Error('Usage: node scripts/check-workspace-policy.mjs --workspace <path> --manifest <scenario.json> [--json]');
	}

	return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = parseArgs(process.argv.slice(2));
	const manifest = JSON.parse(fs.readFileSync(args.manifestPath, 'utf8'));
	const result = checkWorkspacePolicy({
		workspaceRoot: args.workspaceRoot,
		manifest,
	});

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.passed) {
		console.log('Workspace policy passed.');
	} else {
		console.error(`Workspace policy failed: ${result.violations.map((violation) => `${violation.path}:${violation.reason}`).join(', ')}`);
	}

	process.exit(result.passed ? 0 : 1);
}
