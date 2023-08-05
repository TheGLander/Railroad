import express, { Request, ErrorRequestHandler } from "express"
import { notFound, isBoom, badImplementation } from "@hapi/boom"
import { getPackBestMetrics as getPackBolds } from "./bolds.js"
import cors from "cors"

import "express-async-errors"

const app = express()
app.use(cors())

app.get("/railroad", (_req, res) => {
  res.send("Hello!")
})

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
