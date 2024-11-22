import * as dotenv from "dotenv"
dotenv.config()

import express, { ErrorRequestHandler } from "express"
import { isBoom, badImplementation } from "@hapi/boom"
import cors from "cors"
import "express-async-errors"
import { connect } from "mongoose"
import { router as levelRouter, updateLevelModel } from "./levels.js"
import { router as boldRouter } from "./bolds.js"
import { User, assertArgon2Ready, router as userRouter } from "./users.js"
import { router as routesRouter } from "./routes.js"
import { router as triviaRouter } from "./trivia.js"
import { tinyws } from "tinyws"

assertArgon2Ready()

const app = express()

// @ts-expect-error No idea why Typescript doesn't like this
app.use(tinyws())

await connect(process.env.MONGODB_LINK!)
await updateLevelModel()

app.use("/railroad", cors(), boldRouter)
app.use("/railroad", cors(), levelRouter)
app.use("/railroad", userRouter)
app.use("/railroad", cors(), routesRouter)
app.use("/railroad", triviaRouter)

app.use("/railroad", express.static("./page"))

// Error handling
app.use(((err, _req, res, _next) => {
  if (!isBoom(err)) {
    console.error(err)
    err = badImplementation("Internal error")
  }
  res.writeHead(err.output.statusCode, err.output.headers)
  res.write(err.message)
  res.end()
}) as ErrorRequestHandler)

const port = 4943

app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
})
