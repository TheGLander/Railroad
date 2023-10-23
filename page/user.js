function readAuthToken() {
  const authToken = localStorage.getItem("railroad-auth-token")
  const userName = authToken !== null ? atob(authToken).split(":")[0] : null
  if (authToken) {
    document.body.setAttribute("data-logged-in", "")
    usernameText.textContent = userName
  } else {
    document.body.removeAttribute("data-logged-in")
  }
}

readAuthToken()

copyAuthTokenButton.addEventListener("click", () => {
  navigator.clipboard.writeText(localStorage.getItem("railroad-auth-token"))
})

async function submitUsername() {
  if (userNameInput.value === "") return
  const res = await fetch("./users", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "",
    },
    body: JSON.stringify({ userName: userNameInput.value }),
  })
  if (!res.ok) {
    alert(`Couldn't set username: ${await res.text()}`)
    return
  }

  const userInfo = await res.json()

  localStorage.setItem(
    "railroad-auth-token",
    btoa(`${userInfo.userName}:${userInfo.authId}`)
  )
  readAuthToken()
}

export function makeAuthHeader(
  token = localStorage.getItem("railroad-auth-token")
) {
  return {
    authorization: `Basic ${token}`,
  }
}

export function getAuthInfo(
  token = localStorage.getItem("railroad-auth-token")
) {
  const authParts = atob(token).split(":")
  return { username: authParts[0], password: authParts[1] }
}

async function readUserProvidedToken(token) {
  const res = await fetch("./users", {
    method: "POST",
    headers: makeAuthHeader(token),
  })

  if ((await res.text()) !== "Already authorized") {
    alert("Couldn't use this token...")
    return
  }
  localStorage.setItem("railroad-auth-token", token)
  readAuthToken()
}

submitUsernameButton.addEventListener("click", submitUsername)
useAuthTokenButton.addEventListener("click", async () => {
  const token = prompt("Enter token")
  if (!token) return
  readUserProvidedToken(token)
})
