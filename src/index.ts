// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

import { IssueComment, Status } from 'github-webhook-event-types'
import { Application, Context } from 'probot'

// tslint:disable-next-line:no-submodule-imports
import { IssueCommentIssue } from 'github-webhook-event-types/source/IssueComment'
import { BuildInfo } from './ci'
import { GitHub } from './github'
import { Travis } from './travis'

const inProgress = new Set()
const secondChance = new Map()
let appId = parseInt(process.env.APP_ID || '', 10)

interface IssueCommentPullRequestIssue extends IssueCommentIssue {
  readonly pull_request?: object
}

async function getAppId (context: Context): Promise<number> {
  if (!appId) {
    appId = (await context.github.apps.get({})).data.id as number
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
  app.on('issue_comment', async context => {
    const issueComment: IssueComment = context.payload
    const issue = issueComment.issue as IssueCommentPullRequestIssue
    const repo = issueComment.repository

    if (
      issue.pull_request !== undefined &&
      issueComment.action !== 'deleted' &&
      issueComment.comment.body.toLowerCase() === '/ci rescan'
    ) {
      context.log(`Rescan requested for PR ${issue.number} in ${repo.full_name}`)
      await GitHub.deleteComment(context, issueComment)

      const status = await GitHub.getLatestTravisStatus(context, issueComment)
      if (!status) {
        context.log(`No Travis run found for PR ${issue.number} in ${repo.full_name}`)
        return
      }

      const buildInfo = Travis.parseStatus(status)
      if (!buildInfo) {
        context.log(
          `Could not extract build info from latest Travis run for PR ${issue.number} in ${
            repo.full_name
          }`
        )
        return
      }

      await processJobs(context, buildInfo)
    }
  })

  app.on('status', async context => {
    context.log(`Processing status update ${context.payload.id}`)
    const status: Status = context.payload
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
      }

      if (secondChance.has(key)) {
        try {
          await processJobs(context, buildInfo)
        } catch (e) {
          context.log.error(
            e,
            `Error occurred processing jobs for status update ${secondChance.get(
              key
            )} (from second chance)`
          )
        }
      }

      inProgress.delete(key)
      secondChance.delete(key)
    } else if (!secondChance.has(key)) {
      secondChance.set(key, context.payload.id)
      context.log(
        `Job processing already in progress for status update ${
          context.payload.id
        }, registering for second chance...`
      )
    } else {
      context.log(
        `Job processing already in progress for status update ${context.payload.id}, skipping...`
      )
    }

    context.log(`Finished processing status update ${context.payload.id}`)
  })
}
