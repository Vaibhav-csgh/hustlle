#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');
const https = require('https');
const url = require('url');
require('dotenv').config();

// ANSI color codes for better terminal output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

/**
 * Extract Jira ticket key from commit message
 * Supports formats: JNYY-123, jnyy-123, [JNYY-123], feat: JNYY-123 description
 */
function extractJiraTicket(commitMessage) {
  const jiraPattern = /\b(JNYY-\d+)\b/i;
  const match = commitMessage.match(jiraPattern);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Get the latest commit message
 */
function getLatestCommitMessage() {
  try {
    return execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error(`${colors.red}Error getting commit message:${colors.reset}`, error.message);
    return null;
  }
}

/**
 * Validate time format (e.g., 30m, 1h, 2h30m, 1d, 1w)
 */
function validateTimeFormat(timeString) {
  const timePattern = /^(\d+w)?(\d+d)?(\d+h)?(\d+m)?$/;
  return timePattern.test(timeString) && timeString.length > 0;
}

/**
 * Convert time string to seconds for Jira API
 */
function timeToSeconds(timeString) {
  let totalSeconds = 0;

  const weeks = timeString.match(/(\d+)w/);
  const days = timeString.match(/(\d+)d/);
  const hours = timeString.match(/(\d+)h/);
  const minutes = timeString.match(/(\d+)m/);

  if (weeks) totalSeconds += parseInt(weeks[1]) * 7 * 24 * 60 * 60;
  if (days) totalSeconds += parseInt(days[1]) * 24 * 60 * 60;
  if (hours) totalSeconds += parseInt(hours[1]) * 60 * 60;
  if (minutes) totalSeconds += parseInt(minutes[1]) * 60;

  return totalSeconds;
}

/**
 * Create readline interface for user input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input with validation
 */
function promptUser(question, validator = null) {
  const rl = createReadlineInterface();

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question(question, (answer) => {
        if (validator && !validator(answer.trim())) {
          console.log(`${colors.red}Invalid input. Please try again.${colors.reset}`);
          askQuestion();
        } else {
          rl.close();
          resolve(answer.trim());
        }
      });
    };
    askQuestion();
  });
}

/**
 * Make HTTP request to Jira API
 */
function makeJiraRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: body ? JSON.parse(body) : null });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Check if Jira ticket exists
 */
async function checkJiraTicket(ticketKey) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  const parsedUrl = url.parse(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}`);
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.path,
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    }
  };

  try {
    const response = await makeJiraRequest(options);
    return { exists: true, issue: response.body };
  } catch (error) {
    console.error(colors.red + 'Jira API error (ticket check):' + colors.reset, error);
    if (error.message && error.message.includes('404')) {
      return { exists: false, error: 'Ticket not found' };
    }
    throw error;
  }
}

/**
 * Log work time to Jira
 */
async function logWorkTime(ticketKey, timeSpent, comment = '') {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  const parsedUrl = url.parse(`${JIRA_BASE_URL}/rest/api/3/issue/${ticketKey}/worklog`);
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const worklogData = {
    timeSpentSeconds: timeToSeconds(timeSpent),
    comment: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: comment || `Work logged via git commit`
            }
          ]
        }
      ]
    },
    started: new Date().toISOString().replace('Z', '+0000')
  };

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.path,
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await makeJiraRequest(options, worklogData);
    return response.body;
  } catch (error) {
    console.error(colors.red + 'Jira API error (worklog):' + colors.reset, error);
    throw new Error(`Failed to log work time: ${error && error.message ? error.message : error}`);
  }
}

/**
 * Validate environment variables
 */
function validateEnvironment() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`${colors.red}Missing required environment variables:${colors.reset}`);
    missing.forEach(key => console.error(`  - ${key}`));
    console.error(`\n${colors.yellow}Please check your .env file${colors.reset}`);
    return false;
  }

  return true;
}

/**
 * Main function
 */
async function main() {
  try {
    // Validate environment
    if (!validateEnvironment()) {
      process.exit(1);
    }

    // Get latest commit message
    const commitMessage = getLatestCommitMessage();
    if (!commitMessage) {
      console.error(`${colors.red}Could not retrieve commit message${colors.reset}`);
      process.exit(1);
    }

    console.log(`${colors.blue}Commit message:${colors.reset} ${commitMessage}`);

    // Extract Jira ticket
    const ticketKey = extractJiraTicket(commitMessage);
    if (!ticketKey) {
      console.log(`${colors.yellow}No Jira ticket found in commit message. Skipping time logging.${colors.reset}`);
      process.exit(0);
    }

    console.log(`${colors.green}Found Jira ticket:${colors.reset} ${colors.bold}${ticketKey}${colors.reset}`);

    // Check if ticket exists
    console.log(`${colors.blue}Checking if ticket exists...${colors.reset}`);
    const ticketCheck = await checkJiraTicket(ticketKey);

    if (!ticketCheck.exists) {
      console.error(`${colors.red}Ticket ${ticketKey} not found in Jira${colors.reset}`);
      process.exit(1);
    }

    console.log(`${colors.green}✓ Ticket found:${colors.reset} ${ticketCheck.issue.fields.summary}`);

    // Prompt for time spent
    const timeSpent = await promptUser(
      `${colors.blue}Enter time spent (e.g., 30m, 1h, 2h30m):${colors.reset} `,
      validateTimeFormat
    );

    // Prompt for optional comment
    const comment = await promptUser(
      `${colors.blue}Enter work comment (optional):${colors.reset} `
    );

    // Log work time
    console.log(`${colors.blue}Logging work time to Jira...${colors.reset}`);
    const worklog = await logWorkTime(ticketKey, timeSpent, comment);

    console.log(`${colors.green}✓ Successfully logged ${timeSpent} to ${ticketKey}${colors.reset}`);
    if (comment) {
      console.log(`${colors.green}  Comment: ${comment}${colors.reset}`);
    }

  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    process.exit(1);
  }
}

// Run only if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  extractJiraTicket,
  validateTimeFormat,
  timeToSeconds,
  main
};
