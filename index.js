const Travis = require('./app/travis')
const Store = require('./app/store')
const Presenter = require('./app/presenter')

module.exports = app => {
  app.on('status', async context => {
    context.log(`Processing status update ${context.payload.id}`)
    const travis = new Travis(context)
    if (!travis.initialized) {
      context.log(`No Travis info detected in status update ${context.payload.id}`)
      return
    }
    context.log(`Loaded Travis info for build ${travis.buildId}`)

    const jobs = await travis.getSupportedJobs()
    context.log(`Discovered ${Object.keys(jobs).length} supported jobs`)

    const store = new Store()
    const previous = store.updateJobs(travis.buildId, jobs)

    const presenter = new Presenter(travis)
    const diff = await presenter.calculateDiff(previous, jobs)
    context.log(`Pending checks: ${diff.pending}`)
    context.log(`Will create ${diff.create.length} checks and update ${diff.update.length} checks`)

    const operations = []
    operations.push(
      ...diff.create.map(async c => {
        const {jobId, payload} = c
        context.log.debug(`Creating check for job ${jobId}`, payload)
        const result = await context.github.checks.create(payload)
        context.log.debug(`Check ${result.data.id} created for job ${jobId}`)
        store.setCheckRunId(travis.buildId, jobId, result.data.id)
      })
    )
    operations.push(
      ...diff.update.map(async c => {
        const {payload} = c
        context.log.debug(`Updating check`, payload)
        await context.github.checks.update(payload)
      })
    )
    await Promise.all(operations.map(p => p.catch(e => e)))

    if (diff.pending === 0) {
      console.log(`No remaining pending jobs, deleting job info from the store`)
      store.delete(travis.buildId)
    }
    context.log(`Finished processing status update ${context.payload.id}`)
  })
}
