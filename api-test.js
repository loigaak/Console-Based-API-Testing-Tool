#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { validate } = require('jsonschema');

// Environment and report storage
const ENV_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.api_test_env.json');
const REPORT_FILE = path.join(process.cwd(), 'api_test_report.json');

// Load environment variables
async function loadEnv() {
  try {
    return await fs.readJson(ENV_FILE);
  } catch {
    return {};
  }
}

// Save environment variables
async function saveEnv(name, env) {
  const envs = await loadEnv();
  envs[name] = env;
  await fs.writeJson(ENV_FILE, envs, { spaces: 2 });
  console.log(chalk.green(`Environment "${name}" saved!`));
}

// Send HTTP request
async function sendRequest({ method, url, headers = {}, query = {}, body = {} }) {
  try {
    const response = await axios({
      method,
      url,
      headers,
      params: query,
      data: body,
      validateStatus: () => true, // Accept all status codes
    });
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
      responseTime: response.headers['x-response-time'] || 'N/A',
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Interactive testing
async function interactiveTest() {
  const env = await loadEnv();
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Enter API URL:',
      default: env.baseUrl || 'https://api.example.com',
    },
    {
      type: 'list',
      name: 'method',
      message: 'Select HTTP method:',
      choices: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    {
      type: 'input',
      name: 'headers',
      message: 'Enter headers (JSON format, e.g., {"Authorization": "Bearer token"}):',
      default: '{}',
      filter: input => JSON.parse(input),
    },
    {
      type: 'input',
      name: 'query',
      message: 'Enter query params (JSON format, e.g., {"id": 1}):',
      default: '{}',
      filter: input => JSON.parse(input),
    },
    {
      type: 'input',
      name: 'body',
      message: 'Enter request body (JSON format, e.g., {"name": "John"}):',
      default: '{}',
      filter: input => JSON.parse(input),
      when: ({ method }) => ['POST', 'PUT'].includes(method),
    },
    {
      type: 'input',
      name: 'expectedSchema',
      message: 'Enter expected JSON schema (optional, JSON format):',
      default: '{}',
      filter: input => JSON.parse(input),
    },
  ]);

  console.log(chalk.blue('Sending request...'));
  const result = await sendRequest(answers);

  if (result.error) {
    console.log(chalk.red(`Error: ${result.error}`));
    return;
  }

  console.log(chalk.cyan('Response:'));
  console.log(`Status: ${chalk.green(result.status)}`);
  console.log(`Headers: ${JSON.stringify(result.headers, null, 2)}`);
  console.log(`Body: ${JSON.stringify(result.data, null, 2)}`);
  console.log(`Response Time: ${result.responseTime}`);

  if (Object.keys(answers.expectedSchema).length) {
    const schemaValidation = validate(result.data, answers.expectedSchema);
    console.log(chalk.cyan('Schema Validation:'));
    console.log(schemaValidation.valid ? chalk.green('Valid') : chalk.red('Invalid'));
    if (!schemaValidation.valid) {
      console.log(JSON.stringify(schemaValidation.errors, null, 2));
    }
  }
}

// Run test suite
async function runTestSuite(file) {
  const tests = await fs.readJson(file);
  const results = [];

  for (const test of tests) {
    console.log(chalk.blue(`Running test: ${test.name}`));
    const result = await sendRequest(test.request);
    const passed = !result.error && result.status === test.expectedStatus &&
      (!test.expectedSchema || validate(result.data, test.expectedSchema).valid);

    results.push({
      name: test.name,
      passed,
      result,
    });

    console.log(passed ? chalk.green('Passed') : chalk.red('Failed'));
    console.log(`Status: ${result.status}, Expected: ${test.expectedStatus}`);
    if (result.error) console.log(chalk.red(`Error: ${result.error}`));
  }

  await fs.writeJson(REPORT_FILE, results, { spaces: 2 });
  console.log(chalk.green(`Test report saved to ${REPORT_FILE}`));
}

// Generate report
async function generateReport() {
  const report = await fs.readJson(REPORT_FILE).catch(() => []);
  console.log(chalk.blue('Test Report:'));
  report.forEach(test => {
    console.log(`${test.name}: ${test.passed ? chalk.green('Passed') : chalk.red('Failed')}`);
    console.log(`Status: ${test.result.status}`);
    if (test.result.error) console.log(chalk.red(`Error: ${test.result.error}`));
  });
  console.log(chalk.cyan(`Total: ${report.length}, Passed: ${report.filter(t => t.passed).length}`));
}

program
  .command('interactive')
  .description('Start interactive API testing')
  .action(() => interactiveTest());

program
  .command('run <file>')
  .description('Run a test suite from a JSON file')
  .action(file => runTestSuite(file));

program
  .command('save <name>')
  .description('Save current environment variables')
  .action(async name => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter base URL:',
        default: 'https://api.example.com',
      },
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter API key (optional):',
      },
    ]);
    await saveEnv(name, answers);
  });

program
  .command('report')
  .description('Generate test report')
  .action(() => generateReport());

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
  console.log(chalk.cyan('Use the "interactive" command to start testing APIs!'));
}
