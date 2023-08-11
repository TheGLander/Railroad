import express, { Request, ErrorRequestHandler } from "express"
import { notFound, isBoom, badImplementation } from "@hapi/boom"
import { getPackBestMetrics as getPackBolds } from "./bolds.js"
import cors from "cors"
import * as dotenv from "dotenv"
import "express-async-errors"
import { connect, model } from "mongoose"
import { userSchema } from "./schemata.js"
import { updateLevelModel } from "./levels.js"

dotenv.config()

await connect(process.env.MONGODB_LINK!)

const User = model("User", userSchema)

const app = express()
app.use(cors())

app.get(
  "/railroad/bolds/:pack/",
  async (req: Request<{ pack: string }>, res) => {
    const packRes = await fetch(
      `https://scores.bitbusters.club/scores/${req.params.pack}`
    )
    if (packRes.status === 404)
      throw notFound(`Pack "${req.params.pack}" not found`)
    else if (!packRes.ok) throw badImplementation("Scores server unresponsive")

    const bolds = getPackBolds(await packRes.text())
    res.contentType("application/json")
    res.send(JSON.stringify(bolds, (_k, v) => v, 2))
  }
)

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

await updateLevelModel()
