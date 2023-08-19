import express, { ErrorRequestHandler } from "express"
import { isBoom, badImplementation } from "@hapi/boom"
import cors from "cors"
import * as dotenv from "dotenv"
import "express-async-errors"
import { connect } from "mongoose"
import { router as levelRouter, updateLevelModel } from "./levels.js"
import { router as boldRouter } from "./bolds.js"
import { router as userRouter } from "./users.js"

dotenv.config()

await connect(process.env.MONGODB_LINK!)
await updateLevelModel()

const app = express()

app.use("/railroad", cors(), boldRouter)
app.use("/railroad", cors(), levelRouter)
app.use("/railroad", userRouter)

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
