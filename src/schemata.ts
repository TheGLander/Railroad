import { HydratedDocument, InferSchemaType, Schema, Types } from "mongoose"

function ref(refModel: string) {
  return { type: Types.ObjectId, ref: refModel }
}

export const userSchema = new Schema({
  userName: String,
  authId: String,
  admin: Boolean,
})

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>

export const routeMovesSchema = new Schema({
  blobMod: Number,
  randomForceFloorDirection: Number,
  moves: String,
})

export type RouteMovesSubDoc = InferSchemaType<typeof routeMovesSchema>

export const routeSchema = new Schema({
  moves: routeMovesSchema,
  absoluteTime: Number,
  timeLeft: Number,
  points: Number,
  routeLabel: String,
  submitter: ref("User"),
  createdAt: Date,
})

export type RouteSubDoc = InferSchemaType<typeof routeSchema>

export const levelSchema = new Schema({
  routes: [routeSchema],
  setName: String,
  title: String,
  levelN: Number,
  boldTime: Number,
  boldScore: Number,
}).index({ setName: 1, levelN: 1 })

export type LevelDoc = HydratedDocument<InferSchemaType<typeof levelSchema>>
