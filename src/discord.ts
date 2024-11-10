import { RouteSubmission } from "./routes.js"
import { LevelDoc, RouteSchema, RouteSubDoc, UserDoc } from "./schemata.js"

function getDiscordSubmissionWebhookUrls() {
  return process.env.DISCORD_SUBMISSIONS_WEBHOOK_URLS?.split(" ") ?? []
}
function getDiscordNewUserWebhookUrls() {
  return process.env.DISCORD_NEW_USER_WEBHOOK_URLS?.split(" ") ?? []
}

function makeLevelName(doc: LevelDoc): string {
  return `${doc.setName!.toUpperCase()} #${doc.levelN!}: ${doc.title!}`
}

function formatTime(time: number): string {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const tick = ((timeSubticks - subtick) / 3) % 20
  return `${Math.ceil(time)}.${
    subtick == 0 && tick === 0 ? 100 : (tick * 5).toString().padStart(2, "0")
  }${["", "⅓", "⅔"][subtick]}`
}

function formatTimeBoldImprovement(thisTime: number, boldTime: number): string {
  return (Math.ceil(thisTime) - Math.ceil(boldTime)).toString()
}

function writeMetric(
  suffix: string,
  thisVal: number,
  boldVal: number,
  format: (val: number) => string = val => val.toString(),
  formatBoldImprovement: (thisVal: number, boldVal: number) => string = (
    thisVal,
    boldVal
  ) => (thisVal - boldVal).toString()
) {
  return Math.ceil(thisVal) < Math.ceil(boldVal)
    ? `${format(thisVal)}${suffix} (b-${-formatBoldImprovement(
        thisVal,
        boldVal
      )})`
    : Math.ceil(thisVal) === Math.ceil(boldVal)
      ? `**${format(thisVal)}${suffix} (b)**`
      : `***${format(thisVal)}${suffix} (b+${formatBoldImprovement(
          thisVal,
          boldVal
        )})***`
}

function formatTimeImprovement(time: number): string {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const timeClean = (timeSubticks - subtick) / 60
  return `${timeClean.toFixed(2)}${["", "⅓", "⅔"][subtick]}`
}

function formatSubmission(
  level: LevelDoc,
  sub: RouteSubmission,
  betterThan: RouteSubDoc[]
): string | null {
  // Find the route *document*, not just the schema, since we need to know
  // the dynamically-generated id. Don't think there's a less stupid way of
  // doing this, since `bulkSave` doesn't give subdoc IDs, as far as I can tell.
  const route = sub.level.routes.find(
    route =>
      route.createdAt === sub.route.createdAt &&
      route.routeLabel === sub.route.routeLabel &&
      route.timeLeft === sub.route.timeLeft &&
      route.points === sub.route.points
  )
  if (!route) {
    return null
  }
  // Which metrics the route should be reported as being good as, `null` means all metrics
  let routeMetrics: string | null
  let routeImprovement = ""
  const isRouteMainlineScore = level.mainlineScoreRoute?.id === route.id
  const isRouteMainlineTime = level.mainlineTimeRoute?.id === route.id
  if (level.setName === "cc1") {
    routeMetrics = null
    const oldRoute = betterThan[0]
    if (oldRoute) {
      routeImprovement = `, an improvement of ${formatTimeImprovement(
        route.timeLeft! - oldRoute.timeLeft!
      )}s`
    }
  } else if (betterThan.length === 2) {
    // This route is better than both old time/score metrics, just display the all text without giving an improvement
    routeMetrics = null
  } else {
    const oldRoute = betterThan[0]
    routeMetrics =
      isRouteMainlineScore && isRouteMainlineTime
        ? null
        : `mainline ${isRouteMainlineScore ? "score" : "time"}`
    // NOTE: This returns funny results when a route targeting one metric is submitted
    // when there's a generic mainline route, such as "an improvement of -2s / 80pts",
    // but I figure that's fine.
    if (oldRoute) {
      routeImprovement = `, an improvement of ${formatTimeImprovement(
        route.timeLeft! - oldRoute.timeLeft!
      )}s / ${route.points! - oldRoute.points!}pts`
    }
  }
  const scorePart = ` / ${writeMetric("pts", route.points!, level.boldScore!)}`
  return `• [New **${route.routeLabel ? `"${route.routeLabel}" ` : ""}${route.isMainline ? "mainline" : "__non-mainline__"}${routeMetrics ? ` ${routeMetrics}` : ""}** route: ${writeMetric(
    "s",
    route.timeLeft!,
    level.boldTime!,
    formatTime,
    formatTimeBoldImprovement
  )}${
    level.setName === "cc1" ? "" : scorePart
  }${routeImprovement}](https://glander.club/railroad/#${level.setName!}-${route.id!})`
}

export async function announceNewRouteSubmissions(
  submissions: RouteSubmission[],
  submittingUser: UserDoc,
  mainlineSubmissionsBetterThan: Map<RouteSubmission, RouteSubDoc[]>
): Promise<void> {
  const subLevels = submissions
    .map(sub => sub.level)
    .filter((lvl, i, arr) => arr.findIndex(flvl => flvl.id === lvl.id) === i)
    .sort((a, b) => (a.levelN ?? 0) - (b.levelN ?? 0))
    .sort((a, b) => a.setName!.localeCompare(b.setName!))

  const fields: any[] = []

  let processedSubmissions = 0

  for (const level of subLevels) {
    const fieldName = makeLevelName(level)
    const subs = submissions.filter(sub => sub.level.id === level.id)
    processedSubmissions += subs.length
    const fieldValue = subs
      .map(sub =>
        formatSubmission(level, sub, mainlineSubmissionsBetterThan.get(sub)!)
      )
      .join("\n")

    fields.push({ name: fieldName, value: fieldValue })
    if (fields.length === 24 && subLevels.length > 25) break
  }

  const unprocessedLevels = subLevels.length - fields.length

  if (unprocessedLevels > 0) {
    fields.push({
      name: `And ${unprocessedLevels} other levels`,
      value: `with **${submissions.length - processedSubmissions}** new routes`,
    })
  }

  const embed = {
    title: `New route${submissions.length > 1 ? "s" : ""}!`,
    color: 0xffff00,
    fields,
    author: {
      name: `Submission${
        submissions.length > 1 ? "s" : ""
      } by ${submittingUser.userName!}`,
    },
    timestamp: new Date().toISOString(),
  }
  const fullMessage = {
    content: null,
    embeds: [embed],
    attachments: [],
  }
  for (const url of getDiscordSubmissionWebhookUrls()) {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(fullMessage),
      headers: { "Content-Type": "application/json" },
    })
  }
}

export async function announceNewUser(user: UserDoc): Promise<void> {
  const fullMessage = {
    content: `New user: ${user.userName}`,
    embeds: [],
    attachments: [],
  }
  for (const url of getDiscordNewUserWebhookUrls()) {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(fullMessage),
      headers: { "Content-Type": "application/json" },
    })
  }
}
