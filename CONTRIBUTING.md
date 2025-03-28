# Guidelines for Contributing Code

New Relic welcomes code contributions by the Node community to this module, and
have taken effort to make this process easy for both contributors and our
development team.

## Process

### Feature Requests

Feature requests should be submitted in the [Issue tracker](../../issues), with
a description of the expected behavior & use case. Before submitting an Issue,
please search for similar ones in the [closed
issues](../../issues?q=is%3Aissue+is%3Aclosed+label%3Aenhancement).

### Pull Requests

We can only accept PRs for version v6.11.0 or greater due to open source
licensing restrictions.

### Code of Conduct

Before contributing please read the [code of conduct](https://github.com/newrelic/.github/blob/main/CODE_OF_CONDUCT.md)

Note that our [code of conduct](https://github.com/newrelic/.github/blob/main/CODE_OF_CONDUCT.md) applies to all platforms
and venues related to this project; please follow it in all your interactions
with the project and its participants.

### Contributor License Agreement

Keep in mind that when you submit your Pull Request, you'll need to sign the
CLA via the click-through using CLA-Assistant. If you'd like to execute our
corporate CLA, or if you have any questions, please drop us an email at
opensource@newrelic.com.

For more information about CLAs, please check out Alex Russell’s excellent
post, [“Why Do I Need to Sign
This?”](https://infrequently.org/2008/06/why-do-i-need-to-sign-this/).

## PR Guidelines

### Version Support

When contributing, keep in mind that New Relic customers (that's you!) are running many different versions of Node, some of them pretty old. Changes that depend on the newest version of Node will probably be rejected, especially if they replace something backwards compatible.

Be aware that the instrumentation needs to work with a wide range of versions of the instrumented modules, and that code that looks nonsensical or overcomplicated may be that way for compatibility-related reasons. Read all the comments and check the related tests before deciding whether existing code is incorrect.

If you’re planning on contributing a new feature or an otherwise complex contribution, we kindly ask you to start a conversation with the maintainer team by opening up an Github issue first.

### General Guidelines

In general, we try to limit adding third-party production dependencies. If one is necessary, please be prepared to make a clear case for the need.

### Coding Style Guidelines/Conventions

We use eslint to enforce certain coding standards. Please see our [eslint.config.js](./eslint.config.js) file for specific rule configuration.

### Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) to format commit messages for this repository. Conventional Commits provide a standardized format for commit messages that allows for automatic generation of changelogs and easy tracking of changes.

When contributing to this repository, please ensure that your commit messages adhere to the Conventional Commit guidelines. Specifically, your commit messages should:

* Start with a type, indicating the kind of change being made (e.g. `feat` for a new feature, `fix` for a bugfix, etc.). The types we support are:
  * `build`: changes that affect the build system or external dependencies
  * `chore`: changes that do not modify source or test files
  * `ci`: changes to our CI configuration files and scripts
  * `docs`: documentation additions or updates
  * `feat`: new features or capabilities added to the agent
  * `fix`: bugfixes or corrections to existing functionality
  * `perf`: performance improvements
  * `refactor`: changes that do not add new feature or fix bugs, but improve code structure or readability
  * `revert`: revert a previous commit
  * `security`: changes related to the security of the agent, including the updating of dependencies due to CVE
  * `style` - changes that do not affect the meaning of the code (e.g. formatting, white-space, etc.)
  * `test` - adding new tests or modifying existing tests
* Use the imperative, present tense (e.g. "add feature" instead of "added feature")
* Optionally, include a scope in parantheses after the type to indicate which part of the repository is affected (e.g. `feat(instrumentation): add support for Prisma Client`)

Please note that we use the [Squash and Merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges#squash-and-merge-your-commits) method when merging Pull Requests into the main branch. We do not use the original commit messages from each individual commit. Instead, we use the Pull Request title as the commit message for the squashed commit, and as such, require that the Pull Request title adheres to our Conventional Commit standards. Any additional documentation or information relevant to the release notes should be added to the "optional extended description" section of the squash commit on merge.

### Testing Guidelines

The agent includes a suite of unit and functional tests which should be used to
verify your changes don't break existing functionality.

Unit tests are stored in `test/`. They're written in
[node-tap](https://github.com/isaacs/node-tap), and have the extension `.test.js`.

Generic functional tests are stored in `test/integration/`. They're written in
[node-tap](https://github.com/isaacs/node-tap), and have the extension
`.tap.js`.

Functional tests against specific versions of instrumented modules are stored
in `test/versioned/`. They are also written in `node-tap`.

#### Setup

To run the tests you need an openssl command-line binary, and some services:

* Cassandra
* Memcached
* MongoDB
* MySQL
* Postgres
* Redis

If you have these all running locally on the standard ports, then you are good
to go. However, the suggested path is to use [Docker](https://www.docker.com).
If you use macOS or Windows, install [Docker Desktop]
(https://www.docker.com/products/docker-desktop). Then, run `npm run services`
to download and launch docker containers for each of the above services.

If you have these services available on non-standard ports or elsewhere on your
network, you can use the following environment variables to tell the tests
where they are:

* NR_NODE\_TEST_&lt;service&gt;\_HOST
* NR_NODE\_TEST_&lt;service&gt;\_PORT

The service token is the all-caps version of the service name listed above.

#### Running Tests

Running the test suite is simple. Just run:

    npm test

This will install all the necessary modules (and do any required SSL
certificate creation) and run the unit tests in standalone mode, followed by
the functional tests if all of the unit tests pass.

If you don't feel like dealing with the hassle of setting up the servers, just
the unit tests can be run with:

    npm run unit

#### Writing Tests

For most contributions it is strongly recommended to add additional tests which
exercise your changes. This helps us efficiently incorporate your changes into
our mainline codebase and provides a safeguard that your change won't be broken
by future development. Because of this, we require that all changes come with
tests. You are welcome to submit pull requests with untested changes, but they
won't be merged until you or the development team have an opportunity to write
tests for them.

There are some rare cases where code changes do not result in changed
functionality (e.g. a performance optimization) and new tests are not required.
In general, including tests with your pull request dramatically increases the
chances it will be accepted.
