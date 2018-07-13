// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { Status } from 'github-webhook-event-types'
import { Application, Context } from 'probot'

import { BuildInfo } from './ci'
import { GitHub } from './github'
import { Travis } from './travis'

const inProgress = new Set()
let appId = parseInt(process.env.APP_ID || '', 10)

async function getAppId (context: Context): Promise<number> {
  if (!appId) {
    appId = (await context.github.apps.get({})).data.id
  }
  return appId
}

async function processJobs (context: Context, buildInfo: BuildInfo): Promise<void> {
  const travis = new Travis(context, buildInfo)
  const jobs = await travis.getSupportedJobs()
  if (!jobs) {
    return
  }
  context.log(`Discovered ${jobs.length} supported jobs`)

  const app = await getAppId(context)
  const github = new GitHub(app, context, buildInfo, travis.getJobOutput.bind(travis))
  const toCreate = await github.checksToCreate(jobs)
  context.log(`Will create or update ${toCreate.length} checks`)

  const operations = toCreate.map(j => github.createCheck(j))
  await Promise.all(operations.map(p => p.catch(e => e)))
}

function getProgressKey (buildInfo: BuildInfo): string {
  // Build ID is unique per Travis installation
  return `${buildInfo.domain}/${buildInfo.id}`
}

export = (app: Application) => {
  app.on('status', async context => {
    context.log(`Processing status update ${context.payload.id}`)
    // tslint:disable-next-line:no-unnecessary-type-assertion
    const status = (context.payload as any) as Status
    const buildInfo = Travis.parseStatus(status)
    if (!buildInfo) {
      context.log(`No Travis info detected in status update ${context.payload.id}`)
      return
    }
    context.log(`Travis info detected in status update ${context.payload.id}`)

    const key = getProgressKey(buildInfo)
    if (!inProgress.has(key)) {
      inProgress.add(key)
      context.log(`Processing jobs for status update ${context.payload.id}`)
      try {
        await processJobs(context, buildInfo)
      } catch (e) {
        context.log.error(
          e,
          `Error occurred processing jobs for status update ${context.payload.id}`
        )
      } finally {
        inProgress.delete(key)
      }
    } else {
      context.log(
        `Job processing already in progress for status update ${context.payload.id}, skipping...`
      )
    }

    context.log(`Finished processing status update ${context.payload.id}`)
  })
}
