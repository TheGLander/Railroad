import {
  HydratedDocument,
  InferSchemaType,
  Model,
  ObtainSchemaGeneric,
  Schema,
  Types,
} from "mongoose"
import { extraTicksFromCeilTime } from "./utils.js"

function ref(refModel: string) {
  return { type: Types.ObjectId, ref: refModel }
}

type InferModelType<TSchema> = Model<
  InferSchemaType<TSchema>,
  ObtainSchemaGeneric<TSchema, "TQueryHelpers">,
  ObtainSchemaGeneric<TSchema, "TInstanceMethods">,
  ObtainSchemaGeneric<TSchema, "TVirtuals">,
  HydratedDocument<
    InferSchemaType<TSchema>,
    ObtainSchemaGeneric<TSchema, "TVirtuals"> &
      ObtainSchemaGeneric<TSchema, "TInstanceMethods">,
    ObtainSchemaGeneric<TSchema, "TQueryHelpers">
  >,
  TSchema
> &
  ObtainSchemaGeneric<TSchema, "TStaticMethods">

type InferDocType<TSchema> = ReturnType<InferModelType<TSchema>["hydrate"]>

type InferSubdocType<TSchema> = Types.Subdocument<Types.ObjectId> &
  InferSchemaType<TSchema>

export const userSchema = new Schema({
  userName: String,
  hash: String,
  admin: Boolean,
})

export type UserDoc = InferDocType<typeof userSchema>

export const routeMovesSchema = new Schema(
  {
    BlobMod: Number,
    "Initial Slide": Number,
    Moves: String,
  },
  { strict: false }
)

export type RouteMovesSubDoc = InferSubdocType<typeof routeMovesSchema>

export const routeSchema = new Schema({
  moves: routeMovesSchema,
  absoluteTime: Number,
  timeLeft: Number,
  points: Number,
  routeLabel: String,
  submitter: ref("User"),
  createdAt: Date,
  isMainline: Boolean,
  glitches: [String],
})

export type RouteSubDoc = InferSubdocType<typeof routeSchema>
export type RouteSchema = InferSchemaType<typeof routeSchema>

export function findMainlineRoute(
  level: LevelDoc,
  comparator: (a: RouteSubDoc, b: RouteSubDoc) => number,
  exclude: RouteSubDoc[]
): RouteSubDoc | null {
  return Array.from(level.routes).reduce<null | RouteSubDoc>((acc, val) => {
    if (!val.isMainline) return acc
    if (exclude.some(exRoute => exRoute._id!.equals(val._id!))) return acc
    if (!acc) return val
    if (comparator(val, acc) < 0) return acc
    if (comparator(val, acc) > 0) return val
    // Prefer the route with the better decimal
    if (extraTicksComparator(val, acc) < 0) return acc
    if (extraTicksComparator(val, acc) > 0) return val
    // I guess prefer the more recent route?
    return val
  }, null)
}

export function timeComparator(a: RouteSubDoc, b: RouteSubDoc) {
  return a.timeLeft! - b.timeLeft!
}

export function scoreComparator(a: RouteSubDoc, b: RouteSubDoc) {
  return a.points! - b.points!
}

export function extraTicksComparator(a: RouteSubDoc, b: RouteSubDoc) {
  return (
    extraTicksFromCeilTime(a.timeLeft!) - extraTicksFromCeilTime(b.timeLeft!)
  )
}

export const levelSchema = new Schema(
  {
    routes: [routeSchema],
    setName: String,
    title: String,
    levelN: Number,
    boldTime: Number,
    boldScore: Number,
    disallowedTime: Number,
    disallowedScore: Number,
  },
  {
    virtuals: {
      mainlineTimeRoute: {
        get(): RouteSubDoc | null {
          return findMainlineRoute(this as LevelDoc, timeComparator, [])
        },
      },
      mainlineScoreRoute: {
        get(): RouteSubDoc | null {
          return findMainlineRoute(this as LevelDoc, scoreComparator, [])
        },
      },
    },
  }
)
  .index({ setName: 1, levelN: 1 })
  .index({ setName: 1 })

export type LevelDoc = InferDocType<typeof levelSchema>
