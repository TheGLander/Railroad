import { Request, Response, Router, json } from "express"
import { model } from "mongoose"
import { UserDoc, userSchema } from "./schemata.js"
import { badRequest, forbidden, unauthorized } from "@hapi/boom"
import { randomBytes } from "crypto"
import { stringify } from "./utils.js"
import { announceNewUser } from "./discord.js"
import { argon2id, hash, verify } from "argon2"

// Argon2 parameters in the env are in the form of "[parallelism] [memoryExp] [timeCost]"
function getArgon2HashParams() {
  const paramsArr = process.env.ARGON2_PARAMETERS?.split(" ")
  if (!paramsArr || paramsArr.length !== 3)
    throw new Error("Invalid argon2 parameters supplied! This is VERY bad!!")
  const params = {
    parallelism: parseInt(paramsArr[0]),
    memoryCost: 2 ** parseInt(paramsArr[1]),
    timeCost: parseInt(paramsArr[2]),
  }
  if (
    isNaN(params.timeCost) ||
    isNaN(params.memoryCost) ||
    isNaN(params.parallelism)
  )
    throw new Error("Argon2 parameters aren't numbers!")
  return params
}

export function assertArgon2Ready() {
  void getArgon2HashParams()
}

export const User = model("User", userSchema)

const AUTH_ID_LENGTH = 16

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

export async function userFromToken(token: string) {
  const [userName, authId] = Buffer.from(token, "base64")
    .toString("utf-8")
    .split(":")
  const user = await User.findOne({ userName })
  if (!user || !user.hash) return null
  const passwordMatches = await verify(user.hash, authId)
  if (!passwordMatches) {
    console.log(`Incorrect authId login for ${userName}`)
    return null
  }
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

  const authId = makeAuthId()

  const hashParams = getArgon2HashParams()
  const userHash = await hash(authId, { ...hashParams, type: argon2id })

  const user = new User({ userName, hash: userHash, admin: false })

  await user.save()

  res.contentType("application/json")
  res.write(stringify({ userName, authId }))
  res.end()
  await announceNewUser(user)
})

export async function getUser(req: Request, res: Response): Promise<UserDoc> {
  if (!req.headers.authorization) {
    res.setHeader("WWW-Authenticate", "Basic")
    throw forbidden("No authorization provided")
  }
  const user = await parseAuth(req.headers.authorization)
  if (!user) {
    res.setHeader("WWW-Authenticate", "Basic")
    throw forbidden("Invalid token provided")
  }
  return user
}

router.get("/users/username", async (req, res) => {
  const user = await getUser(req, res)
  res.contentType("application/json")
  res.write(stringify({ userName: user.userName }))
  res.end()
})
