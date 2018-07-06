// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { Status } from 'github-webhook-event-types'
import { Application } from 'probot'

import { GitHub } from './github'
import { Travis } from './travis'

let appId = parseInt(process.env.APP_ID || '', 10)

export = (app: Application) => {
  app.on('status', async context => {
    if (!appId) {
      try {
        appId = (await context.github.apps.get({})).data.id
      } catch (e) {
        context.log.error(e, `Failed to retrieve the App ID for this app`)
        return
      }
    }

    context.log(`Processing status update ${context.payload.id}`)
    // tslint:disable-next-line:no-unnecessary-type-assertion
    const status = (context.payload as any) as Status
    const buildInfo = Travis.parseStatus(status)
    if (!buildInfo) {
      context.log(`No Travis info detected in status update ${context.payload.id}`)
      return
    }

    context.log(`Travis info detected in status update ${context.payload.id}`)
    const travis = new Travis(context, buildInfo)
    const jobs = await travis.getSupportedJobs()
    if (!jobs) {
      return
    }
    context.log(`Discovered ${jobs.length} supported jobs`)

    const github = new GitHub(appId, context, buildInfo, travis.getJobOutput.bind(travis))
    const diff = await github.jobsToUpdate(jobs)
    context.log(`Will create ${diff.create.length} checks and update ${diff.update.length} checks`)

    const operations: Array<Promise<void>> = []
    operations.push(
      ...diff.create.map(async j => {
        await github.createCheck(j)
      })
    )
    operations.push(
      ...diff.update.map(async j => {
        await github.updateCheck(j)
      })
    )
    await Promise.all(operations.map(p => p.catch(e => e)))

    context.log(`Finished processing status update ${context.payload.id}`)
  })
}
