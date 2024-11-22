# Railroad

[Railroad](https://glander.club/notcc) is a service for sharing Chip's Challenge 2 (and CC1 Steam) level routes.

This is the source code for it. Made w/ Express, MongoDB, Typescript, and love (the human kind).

Licensed under GPL 3.0.

## Building/Running

First, make sure you have [NodeJS](https://nodejs.org/), [pnpm](https://pnpm.io/), and an instance of MongoDB ready.

Make a `.env` file containing the following fields:

- `MONGODB_LINK` - a link to your MongoDB database
- `ARGON2_PARAMETERS` - parameters for Argon2 hashing in the form of `[parallelism] [memoryExp] [timeCost]`, eg. `4 17 3`
- `DISCORD_SUBMISSIONS_WEBHOOK_URLS` (optional) - a space-separated list of Discord webhook URLs to send notifications of new submissions to
- `DISCORD_NEW_USER_WEBHOOK_URLS` (optional) - a space-separated list of Discord webhook URLs to send notifications of the creation of new user accounts to

To simply run, first do `pnpm i && pnpm build` to install dependencies and make the JS files, and then `pnpm start` to start the server.

`pnpm dev` will start a server which auto-restarts when you modify the TS files.

`pnpm cli` runs the Railroad CLI, which contains important tools for maintenance, including regularly syncing bolds from bitbusters.club.
