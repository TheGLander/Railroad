import { prismifyOnPage } from "https://unpkg.com/prismify@1.0.0/prismify.js"
prismifyOnPage()

function readAuthToken() {
  const authToken = localStorage.getItem("railroad-auth-token")
  const userName = authToken !== null ? atob(authToken).split(":")[0] : null
  if (authToken) {
    loggedText.style.display = "block"
    signupText.style.display = "none"
    usernameText.textContent = userName
  } else {
    loggedText.style.display = "none"
    signupText.style.display = "block"
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

function makeAuthHeader(token = localStorage.getItem("railroad-auth-token")) {
  return {
    authorization: `Basic ${token}`,
  }
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
