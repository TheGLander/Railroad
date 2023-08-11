import { InferSchemaType, Schema, Types } from "mongoose"

function ref(refModel: string) {
  return { type: Types.ObjectId, ref: refModel }
}

export const userSchema = new Schema({
  userName: String,
  authId: String,
  admin: Boolean,
})

export type User = InferSchemaType<typeof userSchema>

export const routeMovesSchema = new Schema({
  blobMod: Number,
  randomForceFloorDirection: [0, 1, 2, 3],
  moves: String,
})

export type RouteMoves = InferSchemaType<typeof routeMovesSchema>

export const routeSchema = new Schema(
  {
    moves: routeMovesSchema,
    absoluteTime: Number,
    timeLeft: Number,
    bonusScore: Number,
    routeLabel: String,
    submitter: ref("User"),
  },
  { timestamps: true }
)

export type Route = InferSchemaType<typeof routeSchema>

export const levelSchema = new Schema({
  routes: [routeSchema],
  setName: String,
  title: String,
  levelN: Number,
  boldTime: Number,
  boldScore: Number,
}).index({ setName: 1, levelN: 1 })

export type Level = InferSchemaType<typeof levelSchema>
