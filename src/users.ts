import { Router, json } from "express"
import { model } from "mongoose"
import { UserDoc, userSchema } from "./schemata.js"
import { badRequest } from "@hapi/boom"
import { randomBytes } from "crypto"
import { stringify } from "./utils.js"

export const User = model("User", userSchema)

const AUTH_ID_LENGTH = 4

function makeAuthId() {
  const authBytes = randomBytes(AUTH_ID_LENGTH * 2)

  let authId = ""

  for (let idSegment = 0; idSegment < AUTH_ID_LENGTH; idSegment += 1) {
    const bytePos = idSegment * 2
    authId +=
      authBytes[bytePos].toString(16).padStart(2, "0") +
      authBytes[bytePos + 1].toString(16).padStart(2, "0")
    if (idSegment !== AUTH_ID_LENGTH - 1) {
      authId += "-"
    }
  }
  return authId
}

async function userFromToken(token: string) {
  const [userName, authId] = Buffer.from(token, "base64")
    .toString("utf-8")
    .split(":")
  const user = await User.findOne({ userName, authId })
  return user
}

export async function parseAuth(
  header: string | undefined
): Promise<UserDoc | null> {
  if (!header) return null
  const token = header.match(/Basic ([\w+/=]+)/)
  if (!token) return null
  return await userFromToken(token[1])
}

export const router = Router()

router.use(json())

router.post("/users", async (req, res) => {
  if (await parseAuth(req.headers.authorization))
    throw badRequest("Already authorized")

  if (typeof req.body.userName !== "string") throw badRequest("Invalid request")

  const { userName } = req.body

  const existingUser = await User.findOne({ userName })

  if (existingUser) {
    throw badRequest(
      "User with this name already exists. If you've lost your authentification ID, contact G lander/Zee on the Chip's Challenge Bit Busters Club."
    )
  }

  const user = new User({ userName, authId: makeAuthId(), admin: false })

  await user.save()

  res.contentType("application/json")
  res.write(stringify({ userName: user.userName, authId: user.authId }))
  res.end()
})
