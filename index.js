const core = require('@actions/core');
const github = require('@actions/github');
const glob = require("@actions/glob");
const fs = require("fs");
const reportReader = require('./reportReader');

async function findBestFileMatch(file) {
    if (file.startsWith('classpath:')) {
        file = file.substring(10);
    }
    const glober = await glob.create('**/' + file, {
        followSymbolicLinks: false,
    });

    const match = [];
    for await (const featureFile of glober.globGenerator()) {
        match.push(featureFile);
    }

    return match[0];
}

async function buildErrorAnnotations(cucumberError) {
    return {
        path: (await findBestFileMatch(cucumberError.file)) || cucumberError.file,
        start_line: cucumberError.line,
        end_line: cucumberError.line,
        start_column: 0,
        end_column: 0,
        annotation_level: 'failure',
        message: `
        Test Failure: ${cucumberError.title}
        Step: ${cucumberError.step}
        Error: ${cucumberError.error}
        `,
    }

}

(async() => {
    const inputPath = core.getInput("path");
    const accessToken = core.getInput("access-token");
    const globber = await glob.create(inputPath, {
        followSymbolicLinks: false,
    });

    core.info("start to read cucumber logs using path " + inputPath);
    
    for await (const cucumberReportFile of globber.globGenerator()) {
        core.info("found cucumber report " + cucumberReportFile);

        const reportResultString = await fs.promises.readFile(cucumberReportFile);
        const reportResult = JSON.parse(reportResultString);
        const globalInformation = reportReader.globalInformation(reportResult);
        const summary = `
            ${globalInformation.scenarioNumber} Scenarios (${globalInformation.failedScenarioNumber} failed, ${globalInformation.scenarioNumber - globalInformation.failedScenarioNumber} passed)
            ${globalInformation.stepsNumber} Steps (${globalInformation.failedStepsNumber} failed, ${globalInformation.stepsNumber - globalInformation.failedStepsNumber} passed)
        `;
        const errors = reportReader.failures(reportResult);
        const errorAnnotations = await Promise.all(errors.map(buildErrorAnnotations));
        const pullRequest = github.context.payload.pull_request;
        const head_sha = (pullRequest && pullRequest.head.sha) || github.context.sha;
        const annotations = [
            {
                path: "test",
                start_line: 0,
                end_line: 0,
                start_column: 0,
                end_column: 0,
                annotation_level: 'notice',
                message: summary,
            },
            ...errorAnnotations
        ];
        const createCheckRequest = {
            ...github.context.repo,
            name: 'Cucumber report',
            head_sha,
            status: 'completed',
            conclusion: errorAnnotations.lenth == 0 ? 'success' : 'failure',
            output: {
              title: 'Cucumber report',
              summary,
              annotations
            },
          };

        core.info(summary);
        core.info("send global cucumber report data");
        const octokit = github.getOctokit(accessToken); 
        await octokit.checks.create(createCheckRequest);
    }
})();