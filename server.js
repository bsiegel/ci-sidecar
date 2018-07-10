#!/usr/bin/env node
require('ts-node').register()
process.argv.push('./src/index.ts')
require('probot/bin/probot-run')
