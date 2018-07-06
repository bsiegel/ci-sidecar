import { Application } from 'probot'

import { JobInfo } from './ci'
import { GitHub } from './github'
import { Store } from './store'
import { Travis } from './travis'

export = (app: Application) => {
  app.on('status', async context => {
    context.log(`Processing status update ${context.payload.id}`)
    const travis = Travis.tryCreate(context)
    if (!travis) {
      context.log(`No Travis info detected in status update ${context.payload.id}`)
      return
    }
    context.log(`Travis info detected in status update ${context.payload.id}`)

    const buildInfo = await travis.loadBuildInfo()
    if (!buildInfo) {
      return
    }

    context.log(`Loaded Travis info for build ${buildInfo.id}`)

    const jobs = travis.getSupportedJobs()
    context.log(`Discovered ${jobs.length} supported jobs`)

    const store = new Store(context, buildInfo)
    const previous = await store.replace(jobs)

    const github = new GitHub(context, buildInfo, travis.getJobOutput)
    const diff = github.jobsToUpdate(previous, jobs)
    context.log(`Will create ${diff.create.length} checks and update ${diff.update.length} checks`)

    const operations: Array<Promise<void>> = []
    const toStore: JobInfo[] = []
    operations.push(
      ...diff.create.map(async j => {
        const checkRunId = await github.createCheck(j)
        if (checkRunId) {
          j.checkRunId = checkRunId
          toStore.push(j)
        }
      })
    )
    operations.push(
      ...diff.update.map(async j => {
        await github.updateCheck(j)
      })
    )
    await Promise.all(operations.map(p => p.catch(e => e)))
    if (toStore.length > 0) {
      await store.update(toStore)
    }

    context.log(`Finished processing status update ${context.payload.id}`)
  })
}
