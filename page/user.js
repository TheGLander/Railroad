async function readAuthToken() {
  const authToken = localStorage.getItem("railroad-auth-token")
  if (!authToken) {
    document.body.removeAttribute("data-logged-in")
    return
  }
  const usernameRes = await fetch("./users/username", {
    headers: makeAuthHeader(),
  })
  if (!usernameRes.ok) {
    document.body.removeAttribute("data-logged-in")
    throw new Error(`Failed to authorize: ${await usernameRes.text()}`)
  }
  const userName = (await usernameRes.json()).userName
  document.body.setAttribute("data-logged-in", "")
  usernameText.textContent = userName
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

export function getToken() {
  return localStorage.getItem("railroad-auth-token")
}

export function makeAuthHeader(
  token = localStorage.getItem("railroad-auth-token")
) {
  return {
    authorization: `Basic ${token}`,
  }
}

async function readUserProvidedToken(token) {
  const res = await fetch("./users/username", {
    method: "GET",
    headers: makeAuthHeader(token),
  })

  if (!res.ok) {
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
