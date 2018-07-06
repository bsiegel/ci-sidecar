#!/usr/bin/env node
process.argv.push('./dist/index.js')
require('probot/bin/probot-run')
