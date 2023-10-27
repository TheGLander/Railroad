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
          routeImprovement = `, an improvement of ${
            route.timeLeft! - oldRoute.timeLeft!
          }s`
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
          routeImprovement = `, an improvement of ${
            route.timeLeft! - oldRoute.timeLeft!
          }s / ${route.points! - oldRoute.points!}pts`
        }
      }
      function writeMetric(suffix: string, thisVal: number, boldVal: number) {
        return thisVal < boldVal
          ? `${thisVal}${suffix}`
          : thisVal === boldVal
          ? `**${thisVal}${suffix} (b)**`
          : `***${thisVal}${suffix} (b+${thisVal - boldVal})***`
      }
      const lineValue = `• [New **${routeType}** route: ${writeMetric(
        "s",
        route.timeLeft!,
        level.boldTime!
      )} / ${writeMetric(
        "pts",
        route.points!,
        level.boldScore!
      )}${routeImprovement}](https://glander.club/railroad/#${level.setName!}-${route.id!})`
      fieldValue += lineValue + "\n"
    }
    fields.push({ name: fieldName, value: fieldValue })
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
