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

function getMainlineTimeRoute(level: LevelDoc): RouteSubDoc | null {
  return Array.from(level.routes)
    .reverse()
    .reduce<null | RouteSubDoc>(
      (acc, val) =>
        val.isMainline &&
        (acc === null ||
          (val.timeLeft && acc.timeLeft && val.timeLeft > acc.timeLeft))
          ? val
          : acc,
      null
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
  },
  // This is a huge mess :)
  {
    virtuals: {
      mainlineTimeRoute: {
        get(): RouteSubDoc | null {
          return getMainlineTimeRoute(this as LevelDoc)
        },
      },
      mainlineScoreRoute: {
        get() {
          const scoreRoute = Array.from(this.routes)
            .reverse()
            .reduce<null | RouteSubDoc>(
              (acc, val) =>
                val.isMainline &&
                (acc === null ||
                  (val.points && acc.points && val.points > acc.points))
                  ? val
                  : acc,
              null
            )
          // If the mainline time route is just as good, just return that to minimize time/score splits
          const timeRoute = getMainlineTimeRoute(this as LevelDoc)
          if (timeRoute?.points === scoreRoute?.points) return timeRoute
          return scoreRoute
        },
      },
    },
  }
)
  .index({ setName: 1, levelN: 1 })
  .index({ setName: 1 })

export type LevelDoc = InferDocType<typeof levelSchema>
