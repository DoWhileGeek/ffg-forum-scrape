import _path from "path"

import axios from "axios"
import mongodb from "mongodb"
import JSSoup from "jssoup"
import _ from "lodash"

const { MongoClient } = mongodb

const root = "https://reddit.com"
const domain = new URL(root).origin
const mongoUrl = "mongodb://test:test@mongodb:27017"

const client = await MongoClient.connect(mongoUrl, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
const db = client.db("ffg")
const linkColl = db.collection("links")

const insertLink = async (links) => {
  if (!Array.isArray(links)) {
    links = [links]
  }

  linkColl.insertMany(
    links.map((link) => ({
      link: link,
      visited: false,
    }))
  )
}

const updateLink = async (link, payload) => {
  linkColl.updateOne({ link }, { $set: payload })
}

const getLink = async (link) => {
  let source = axios.CancelToken.source()

  setTimeout(() => {
    source.cancel()
  }, 10000)

  const resp = await axios.get(link, { cancelToken: source.token })
  return resp
}

const delve = async (link) => {
  const record = await linkColl.findOne({ link })

  if (!record) {
    console.log("inserting fresh record")
    insertLink(link)
  }

  if (record && record.visited) {
    console.log(`already visited ${link}, skipping`)
    return
  }

  console.log(`fetching ${link}`)
  let resp
  try {
    resp = await getLink(link)
  } catch (e) {
    console.log("this link is causing trouble", link)
    await updateLink(link, { status: e?.response?.status, error: e.message })
    return
  }
  if (resp.status !== 200) throw "oops"

  let soup
  try {
    soup = new JSSoup.default(resp.data)
  } catch (e) {
    console.log(`${link} caused an issue`)
    return
  }

  const linkTags = soup.findAll("a")

  const links = _.uniq(
    linkTags
      .map((anchor) => {
        if (!anchor.attrs.href) {
          return null
        }
        return new URL(anchor.attrs.href, link).href
      })
      // domain filtering
      .filter((link) => link && link.includes(domain))
      .filter(linkFilter)
      .map(linkMutator)
  )

  let existingLinks = await linkColl
    .find({ link: { $in: links } })
    .project({ link: 1, _id: 0 })
    .toArray()

  const diff = _.difference(
    links,
    existingLinks.map((rec) => rec.link)
  )

  // insert new links for future delving
  if (diff.length) {
    await insertLink(diff)
  }

  // update link we just delved
  await updateLink(link, { visited: true, status: resp.status })

  console.log(`finished ${link}`)
}

const scrape = async () => {
  await delve(root)

  // const moreToDo = async () => {
  //   const count = await linkColl
  //     .find({
  //       visited: false,
  //     })
  //     .count()
  //   return count
  // }

  // while (await moreToDo()) {
  //   let pack = await linkColl
  //     .find({
  //       visited: false,
  //     })
  //     .project({ link: 1, _id: 0 })
  //     .limit(1)
  //     .toArray()

  //   pack = pack.map((rec) => delve(rec.link))

  //   await Promise.all(pack)
  // }
}

const linkFilter = (link) => {
  // must be a topic, or category
  if (!["/topic/", "/forum/"].some((token) => link.includes(token))) {
    return false
  }

  console.log(link)
  return true
}

const linkMutator = (link) => {
  return link
}

await scrape()
