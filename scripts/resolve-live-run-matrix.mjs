import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');

function readJson(file) {
	return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function readText(file) {
	return fs.readFileSync(path.join(root, file), 'utf8').trim();
}

function resolveFrom(baseFile, candidate) {
	if (!candidate) {
		return '';
	}

	return path.normalize(path.join(path.dirname(baseFile), candidate)).replace(/\\/g, '/');
}

function taskSetScenarioIds(taskSetFile) {
	const taskSet = readJson(taskSetFile);
	const ids = [];

	for (const scenarioFile of taskSet.scenario_manifests || []) {
		const scenarioPath = resolveFrom(taskSetFile, scenarioFile);
		const scenario = readJson(scenarioPath);
		ids.push(scenario.id);
	}

	for (const task of taskSet.tasks || []) {
		if (task.scenario_id && !ids.includes(task.scenario_id)) {
			ids.push(task.scenario_id);
		}
	}

	return ids;
}

function scenarioEnvironment(scenario) {
	if (!scenario.environment || typeof scenario.environment !== 'object') {
		throw new Error(`${scenario.id} is missing environment contract metadata.`);
	}

	return scenario.environment;
}

function scenarioBudgets(scenario) {
	const environment = scenarioEnvironment(scenario);
	const truncation = environment.truncation_policy || {};
	const limits = scenario.limits || {};

	return {
		maxTurns: Number(truncation.max_turns || limits.max_turns || 12),
		stepBudget: Number(truncation.step_budget || limits.step_budget || 16),
		timeBudgetMs: Number(truncation.time_budget_ms || limits.time_budget_ms || 600000),
	};
}

function scenarioTask(scenarioFile) {
	const scenario = readJson(scenarioFile);
	const environment = scenarioEnvironment(scenario);
	const budgets = scenarioBudgets(scenario);

	return {
		id: scenario.id,
		label: scenario.label || scenario.id,
		promptFile: resolveFrom(scenarioFile, scenario.prompt_file || scenario.prompt),
		graderFile: resolveFrom(scenarioFile, scenario.grader_file || scenario.grader),
		usesWorkspace: Boolean(environment.uses_workspace),
		allowedTools: environment.allowed_tools || [],
		writableRoots: environment.writable_roots || [],
		hiddenPaths: environment.hidden_paths || [],
		workspaceTemplate: environment.workspace_template || '',
		completionPolicy: environment.completion_policy || {},
		maxTurns: budgets.maxTurns,
		stepBudget: budgets.stepBudget,
		timeBudgetMs: budgets.timeBudgetMs,
		rules: scenario.rules || {},
		generalRules: scenario.general_rules || scenario.rules?.general || [],
		taskRules: scenario.task_rules || scenario.rules?.task_specific || [],
		probes: scenario.probes || {},
	};
}

function smokeTask() {
	const smoke = readJson('tasks/smoke-homepage/manifest.json');

	return {
		id: smoke.id,
		label: smoke.label,
		promptFile: smoke.prompt,
		graderFile: smoke.check,
		usesWorkspace: false,
		allowedTools: [],
		writableRoots: [],
		hiddenPaths: [],
		workspaceTemplate: '',
		completionPolicy: { type: 'agent_final_response' },
		maxTurns: 8,
		stepBudget: 12,
		timeBudgetMs: 600000,
		rules: {},
		generalRules: [],
		taskRules: [],
		probes: {},
	};
}

function providers() {
	return [
		{
			provider: 'openai',
			model: 'gpt-5.5',
			label: 'openai-gpt-5-5',
			providerPlugin: '{}',
		},
		{
			provider: 'anthropic',
			model: 'claude-opus-4-7',
			label: 'anthropic-claude-opus-4-7',
			providerPlugin: JSON.stringify({
				repo: 'WordPress/ai-provider-for-anthropic',
				ref: 'trunk',
				path: '.',
				register_function: 'WordPress\\AnthropicAiProvider\\register_provider',
				credentials: {
					connectors_ai_anthropic_api_key: 'PROVIDER_SECRET_1',
				},
			}),
		},
	];
}

function workspaceConfig(task, branchSlug) {
	if (!task.usesWorkspace) {
		return '{}';
	}

	return JSON.stringify({
		enabled: true,
		repo: 'wp-gym',
		clone_url: 'https://github.com/Automattic/wp-gym.git',
		from: process.env.GITHUB_REF_NAME || 'main',
		branch_prefix: `agent-runs/${branchSlug}`,
		agent_alias: 'current-project',
		agent_root: '.agent-workspace/current-project',
		expose_to_agent: true,
		capture_changes: true,
		workspace_template: task.workspaceTemplate,
		writable_roots: task.writableRoots,
		hidden_paths: task.hiddenPaths,
		commit_message: `feat: complete ${task.id}`,
	});
}

function flowStepPatches(task) {
	if (!task.usesWorkspace) {
		return '[]';
	}

	return JSON.stringify([
		{
			step_type: 'ai',
			merge: {
				enabled_tools: task.allowedTools,
			},
		},
	]);
}

function pipelineStepPatches(task) {
	if (!task.usesWorkspace) {
		return '[]';
	}

	// Completion must come from the agent's final response; a file write alone is
	// not a task-completion signal.
	if (task.completionPolicy.type === 'explicit_final_response') {
		return '[]';
	}

	return '[]';
}

function artifactExportConfig(task, provider) {
	return JSON.stringify({
		include_job_artifacts: true,
		pr_title_template: `[wp-gym] {result_label} - {task_id} - {provider}/{model}`,
		pr_body_template: [
			'## wp-gym Live Run',
			'- **Task:** {task_label}',
			'- **Task ID:** `{task_id}`',
			'- **Provider:** `{provider}`',
			'- **Model:** `{model}`',
			'- **Agent:** `{agent_slug}`',
			'- **Workflow:** {workflow_run_url}',
			'',
			'## Result',
			'- **Success:** `{success}`',
			'- **Reward:** `{reward}`',
			'- **Score:** `{grade_score}` / `{grade_max_score}`',
			'',
			'{result_table}',
			'',
			'## Eval Reproducibility',
			'- **Canonical result schema:** `metadata.eval_artifact` in the Homeboy result JSON.',
			'- **Repo episode schema:** `schemas/episode-result.schema.json`.',
			'- **Input fingerprints:** `metadata.fingerprints` in the Homeboy result JSON.',
			'- **Prompt fingerprint:** `metadata.fingerprints.prompt.sha256`.',
			'- **Bundle fingerprint:** `metadata.fingerprints.bundle.sha256`.',
			'- **Tool policy fingerprint:** `metadata.fingerprints.tool_policy.sha256`.',
			'- **Rule policy:** `metadata.eval_artifact.rules`.',
			'- **Behavioral probes:** `metadata.eval_artifact.probes`.',
			'',
			'## Grade Checks',
			'{checks_table}',
			'',
			'## Changed Files',
			'- **Workspace changed:** {workspace_changed}',
			'- **Changed file count:** `{changed_file_count}`',
			'- **Workspace branch:** `{workspace_branch}`',
			'- **Workspace handle:** `{workspace_handle}`',
			'- **File list:** Review the PR **Files changed** tab for the runner workspace branch.',
			'',
			'## Artifacts and Replay',
			'{links_table}',
			'',
			'## Tool Summary',
			'{tools_table}',
		].join('\n'),
		pr_template_values: {
			task_id: task.id,
			task_label: task.label,
			provider: provider.provider,
			model: provider.model,
			model_label: `${provider.provider}/${provider.model}`,
		},
		pr_template_paths: {
			success: 'run.success',
			reward: 'run.reward',
			grade_score: 'run.grade.score',
			grade_max_score: 'run.grade.max_score',
			changed_file_count: 'run.runner_workspace_capture.status.dirty',
			job_status: 'run.job_status',
			transcript_session_id: 'run.transcript_session_id',
		},
	});
}

function resolveTasks() {
	const homeboy = readJson('homeboy.json');
	const scenarioFiles = homeboy.extensions.wordpress.settings.playground_scenario_manifests || [];
	const smoke = smokeTask();
	const tasks = new Map([[smoke.id, smoke]]);

	for (const scenarioFile of scenarioFiles) {
		const task = scenarioTask(scenarioFile);
		tasks.set(task.id, task);
	}

	const taskSet = process.env.TASK_SET || 'first-live-run';
	const explicitIds = (process.env.TASK_IDS || '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);

	if (taskSet === 'custom' && explicitIds.length === 0) {
		throw new Error('task_ids is required when task_set is custom.');
	}

	const selectedIds = explicitIds.length > 0
		? explicitIds
		: taskSet === 'all'
			? [...tasks.keys()]
			: taskSet === 'smoke'
				? ['smoke-homepage']
				: taskSetScenarioIds(`task-sets/${taskSet}.json`);

	return selectedIds.map((taskId) => {
		const task = tasks.get(taskId);
		if (!task) {
			throw new Error(`Unknown task ID: ${taskId}`);
		}
		return task;
	});
}

function resolveMatrix() {
	const include = [];

	for (const task of resolveTasks()) {
		const prompt = readText(task.promptFile);
		const workloadRunAfter = task.graderFile
			? JSON.stringify([{ type: 'php', file: task.graderFile }])
			: '[]';

		for (const provider of providers()) {
			const branchSlug = `${task.id}-${provider.label}`.replace(/[^A-Za-z0-9_.-]+/g, '-');
			include.push({
				task_id: task.id,
				task_label: task.label,
				provider: provider.provider,
				model: provider.model,
				provider_label: provider.label,
				provider_plugin: provider.providerPlugin,
				prompt,
				workload_run_after: workloadRunAfter,
				rules: JSON.stringify(task.rules),
				general_rules: JSON.stringify(task.generalRules),
				task_rules: JSON.stringify(task.taskRules),
				probes: JSON.stringify(task.probes),
				success_requires_pr: Boolean(task.usesWorkspace),
				runner_workspace: workspaceConfig(task, branchSlug),
				pipeline_step_patches: pipelineStepPatches(task),
				flow_step_patches: flowStepPatches(task),
				artifact_export_config: artifactExportConfig(task, provider),
				max_turns: task.maxTurns,
				step_budget: task.stepBudget,
				time_budget_ms: task.timeBudgetMs,
				artifact_suffix: branchSlug,
			});
		}
	}

	return { include };
}

function parseJsonField(row, field) {
	try {
		return JSON.parse(row[field]);
	} catch (error) {
		throw new Error(`${row.task_id} ${row.provider_label} has invalid JSON in ${field}: ${error.message}`);
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function sameSet(actual, expected, label) {
	const actualValues = [...actual].sort();
	const expectedValues = [...expected].sort();

	assert(
		JSON.stringify(actualValues) === JSON.stringify(expectedValues),
		`${label} expected ${expectedValues.join(', ')}, got ${actualValues.join(', ')}`
	);
}

function checkExpectedShape(matrix, selectedTasks) {
	const taskSet = process.env.TASK_SET || 'first-live-run';
	const explicitIds = (process.env.TASK_IDS || '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
	const expectedByTaskSet = {
		'first-live-run': { rows: 6, workspaceRows: 2 },
		smoke: { rows: 2, workspaceRows: 0 },
		all: { rows: 14, workspaceRows: 4 },
	};
	const expected = explicitIds.length === 0 ? expectedByTaskSet[taskSet] : null;

	if (expected) {
		assert(matrix.include.length === expected.rows, `${taskSet} expected ${expected.rows} rows, got ${matrix.include.length}`);
		const workspaceRows = matrix.include.filter((row) => row.success_requires_pr).length;
		assert(workspaceRows === expected.workspaceRows, `${taskSet} expected ${expected.workspaceRows} workspace rows, got ${workspaceRows}`);
	}

	const taskIds = new Set(selectedTasks.map((task) => task.id));
	sameSet(new Set(matrix.include.map((row) => row.task_id)), taskIds, 'matrix task ids');
}

function assertLiveRunMatrix(matrix) {
	const selectedTasks = resolveTasks();
	const tasksById = new Map(selectedTasks.map((task) => [task.id, task]));
	const providerLabels = new Set(providers().map((provider) => provider.label));

	checkExpectedShape(matrix, selectedTasks);

	for (const task of selectedTasks) {
		const rows = matrix.include.filter((row) => row.task_id === task.id);
		assert(rows.length === providerLabels.size, `${task.id} expected ${providerLabels.size} provider rows, got ${rows.length}`);
		sameSet(new Set(rows.map((row) => row.provider_label)), providerLabels, `${task.id} provider labels`);
	}

	for (const row of matrix.include) {
		const task = tasksById.get(row.task_id);
		assert(task, `Unknown task row: ${row.task_id}`);
		assert(Number(row.max_turns) > 0, `${row.task_id} max_turns must be positive`);
		assert(Number(row.step_budget) > 0, `${row.task_id} step_budget must be positive`);
		assert(Number(row.time_budget_ms) > 0, `${row.task_id} time_budget_ms must be positive`);
		assert(row.workload_run_after !== '[]', `${row.task_id} must run a grader`);

		const pipelinePatches = parseJsonField(row, 'pipeline_step_patches');
		assert(Array.isArray(pipelinePatches) && pipelinePatches.length === 0, `${row.task_id} must not complete from pipeline write side effects`);

		const artifactExport = parseJsonField(row, 'artifact_export_config');
		assert(artifactExport.include_job_artifacts === true, `${row.task_id} must export job artifacts`);
		assert(artifactExport.pr_template_values?.task_id === row.task_id, `${row.task_id} artifact export task id mismatch`);

		if (!task.usesWorkspace) {
			assert(row.success_requires_pr === false, `${row.task_id} non-workspace row must not require PR`);
			assert(row.runner_workspace === '{}', `${row.task_id} non-workspace row must have empty runner workspace`);
			assert(row.flow_step_patches === '[]', `${row.task_id} non-workspace row must not patch tools`);
			continue;
		}

		assert(row.success_requires_pr === true, `${row.task_id} workspace row must require PR`);
		const runnerWorkspace = parseJsonField(row, 'runner_workspace');
		assert(runnerWorkspace.enabled === true, `${row.task_id} workspace must be enabled`);
		assert(runnerWorkspace.clone_url === 'https://github.com/Automattic/wp-gym.git', `${row.task_id} clone_url must target Automattic/wp-gym`);
		assert(runnerWorkspace.workspace_template === task.workspaceTemplate, `${row.task_id} workspace template mismatch`);
		assert(Array.isArray(runnerWorkspace.writable_roots) && runnerWorkspace.writable_roots.includes('plugins/'), `${row.task_id} workspace must limit writes to plugins/`);
		assert(Array.isArray(runnerWorkspace.hidden_paths) && runnerWorkspace.hidden_paths.includes('graders/'), `${row.task_id} workspace must hide graders/`);
		assert(Array.isArray(runnerWorkspace.hidden_paths) && runnerWorkspace.hidden_paths.includes('scenarios/'), `${row.task_id} workspace must hide scenarios/`);

		const flowPatches = parseJsonField(row, 'flow_step_patches');
		assert(flowPatches.length === 1, `${row.task_id} workspace row must patch one AI flow step`);
		sameSet(
			new Set(flowPatches[0]?.merge?.enabled_tools || []),
			new Set(task.allowedTools),
			`${row.task_id} enabled tools`
		);
	}
}

const matrix = resolveMatrix();

if (checkOnly) {
	assertLiveRunMatrix(matrix);
	console.log(`Resolved and checked ${matrix.include.length} live-run matrix entries.`);
} else if (process.env.GITHUB_OUTPUT) {
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
} else {
	console.log(JSON.stringify(matrix, null, 2));
}
