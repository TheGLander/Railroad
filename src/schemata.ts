import {
  HydratedDocument,
  InferSchemaType,
  Model,
  ObtainSchemaGeneric,
  Schema,
  Types,
} from "mongoose"

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
  authId: String,
  admin: Boolean,
})

export type UserDoc = InferDocType<typeof userSchema>

export const routeMovesSchema = new Schema({
  blobMod: Number,
  randomForceFloorDirection: Number,
  moves: String,
})

export type RouteMovesSubDoc = InferSubdocType<typeof routeMovesSchema>

export const routeSchema = new Schema({
  moves: routeMovesSchema,
  absoluteTime: Number,
  timeLeft: Number,
  points: Number,
  routeLabel: String,
  submitter: ref("User"),
  createdAt: Date,
})

export type RouteSubDoc = InferSubdocType<typeof routeSchema>
export type RouteSchema = InferSchemaType<typeof routeSchema>

export const levelSchema = new Schema(
  {
    routes: [routeSchema],
    setName: String,
    title: String,
    levelN: Number,
    boldTime: Number,
    boldScore: Number,
  },
  // This is a huge mess :)
  {
    virtuals: {
      mainlineTimeRoute: {
        get() {
          return this.routes.reduce<null | RouteSubDoc>(
            (acc, val) =>
              acc === null ||
              (val.timeLeft && acc.timeLeft && val.timeLeft > acc.timeLeft)
                ? val
                : acc,
            null
          )
        },
      },
      mainlineScoreRoute: {
        get() {
          return this.routes.reduce<null | RouteSubDoc>(
            (acc, val) =>
              acc === null ||
              (val.points && acc.points && val.points > acc.points)
                ? val
                : acc,
            null
          )
        },
      },
    },
  }
).index({ setName: 1, levelN: 1 })

export type LevelDoc = InferDocType<typeof levelSchema>
