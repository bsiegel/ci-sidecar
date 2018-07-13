# CI Sidecar

Give your CI system a tune-up with CI Sidecar! Sidecar is a GitHub App built on the [Probot platform](https://probot.github.io) that surfaces individual build step results from Sidecar-aware CI builds as individual, customizable checks on your repository's pull requests.

## Supported CI systems

Currently, Sidecar only supports publicly-accessible Travis builds (hosted on either travis-ci.com or travis-ci.org). It can easily be enhanced with support for other CI systems that have existing GitHub integrations, regardless of whether they are using the new GitHub Apps integration or the older GitHub Services integration mode. Support for private builds is also planned.

## Installing Sidecar into your repo

If you wish to use Sidecar for your own repos, clone this repository and follow Probot's [deployment instructions](https://probot.github.io/docs/deployment/) to deploy your own private (or public!) instance of Sidecar.

## How it works

Once installed into your repo, Sidecar listens for status updates from supported CI systems. These updates are pushed to GitHub by CI systems that include GitHub integration whenever a pull request build is kicked off or updated. When an update arrives, Sidecar reads the list of build steps, identifies the steps that have enabled support for Sidecar, and mirrors their status back to the pull request as individual, named checks via GitHub's [Checks API](https://developer.github.com/v3/checks/).

Individual checks will appear in the pull request's checks summary:
![Checks summary](https://developer.github.com/assets/images/checks/check_run_conclusion.png)

As well as in a dedicated section within the pull request's Checks tab:
![Checks tab](https://developer.github.com/assets/images/checks/check_run_ui.png)

## Enabling a step for Sidecar

Any build step that defines a `CHECK_NAME` environment variable will be surfaced by Sidecar as an individual check. The value of this variable is used as the name of the check as it appears on the checks summary and within the Checks tab. This means that to get a Travis job surfaced as a check with Sidecar, it's as easy as adding an environment variable to your `.travis.yml`:

```yml
env:
  - CHECK_NAME="My step"
```

Of course, Sidecar is most useful when your build contains multiple build steps (Travis calls them 'jobs'), either by defining a [build matrix](https://docs.travis-ci.com/user/customizing-the-build/#Build-Matrix) or using the [build stages](https://docs.travis-ci.com/user/build-stages/) feature. Since each job can have its own environment variables, just assign a unique `CHECK_NAME` value to each job and they will all be picked up and surfaced by Sidecar.

## Custom output

When a build step completes, Sidecar will examine the build log output for the step, looking for a **fenced output block**. A fenced output block is similar to Jekyll's concept of [*front matter*](https://jekyllrb.com/docs/frontmatter/), except that it can appear anywhere in the build output (not just at the beginning). In order to identify the block, the opening tag must be followed with the string `output`:

```json
---output
{
    "title": "Step Completed",
    "summary": "The build step completed"
}
---
```

The contents of the block must be a JSON object that adheres to the schema for the Checks API's [output object](https://developer.github.com/v3/checks/runs/#output-object). If a fenced output block is found within the build step's log output, Sidecar's check for that step will be updated to include it. This allows you to easily include rich build output in a pull requests's Checks tab (Github-flavored markdown is supported), as well as include file- and line-specific annotations that will appear inline in the pull request's diff:

![Inline annotations](https://developer.github.com/assets/images/checks/checks_annotation.png)

---
_This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments._
