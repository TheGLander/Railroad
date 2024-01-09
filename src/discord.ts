import { RouteSubmission } from "./routes.js"
import { LevelDoc, RouteSubDoc, UserDoc } from "./schemata.js"

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

function formatTimeImprovement(time: number): string {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const timeClean = (timeSubticks - subtick) / 60
  return `${timeClean.toFixed(2)}${["", "⅓", "⅔"][subtick]}`
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
    let fieldValue = ""
    const subs = submissions.filter(sub => sub.level.id === level.id)
    for (const sub of subs) {
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
        return
      }
      let routeType: string
      let routeImprovement = ""
      if (route.routeLabel !== "mainline") {
        routeType = `"${route.routeLabel}"`
      } else {
        const betterThan = mainlineSubmissionsBetterThan.get(sub)!
        // If this route is better than both existing mainlines, or if there were
        // no mainlines before this one, use generic "new mainline" wording
        if (betterThan.length === 0) {
          routeType = "mainline"
        }
        // If we only have one metric (CC1 Steam), we can only compare against one route,
        // and can generate an improvement string without thinking about it too hard, hurray
        else if (betterThan.length > 1 && level.setName === "cc1") {
          routeType = "mainline"
          const oldRoute = betterThan[0]
          routeImprovement = `, an improvement of ${formatTimeImprovement(
            route.timeLeft! - oldRoute.timeLeft!
          )}s`
        } else {
          const isRouteMainlineScore = level.mainlineScoreRoute?.id === route.id
          const isRouteMainlineTime = level.mainlineTimeRoute?.id === route.id
          const oldRoute = betterThan[0]
          routeType =
            isRouteMainlineScore && isRouteMainlineTime
              ? "mainline"
              : `mainline ${isRouteMainlineScore ? "score" : "time"}`
          // NOTE: This returns funny results when a route targeting one metric is submitted
          // when there's a generic mainline route, such as "an improvement of -2s / 80pts",
          // but I figure that's fine.
          routeImprovement = `, an improvement of ${formatTimeImprovement(
            route.timeLeft! - oldRoute.timeLeft!
          )}s / ${route.points! - oldRoute.points!}pts`
        }
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
          ? `${format(thisVal)}${suffix}`
          : Math.ceil(thisVal) === Math.ceil(boldVal)
            ? `**${format(thisVal)}${suffix} (b)**`
            : `***${format(thisVal)}${suffix} (b+${formatBoldImprovement(
                thisVal,
                boldVal
              )})***`
      }
      const scorePart = ` / ${writeMetric(
        "pts",
        route.points!,
        level.boldScore!
      )}`
      const lineValue = `• [New **${routeType}** route: ${writeMetric(
        "s",
        route.timeLeft!,
        level.boldTime!,
        formatTime,
        formatTimeBoldImprovement
      )}${
        level.setName === "cc1" ? "" : scorePart
      }${routeImprovement}](https://glander.club/railroad/#${level.setName!}-${route.id!})`
      fieldValue += lineValue + "\n"
      processedSubmissions += 1
    }
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
    title: "New routes!",
    color: 0xffff00,
    fields,
    author: {
      name: `Submissions by ${submittingUser.userName!}`,
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
