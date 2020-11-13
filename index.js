import _path from "path"

import axios from "axios"
import mongodb from "mongodb"
import JSSoup from "jssoup"
import _ from "lodash"

const { MongoClient } = mongodb

const mongoUrl = "mongodb://test:test@mongodb:27017"
const client = await MongoClient.connect(mongoUrl, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
const db = client.db("trove")
const linkColl = db.collection("links")

const insertLink = async (links) => {
  if (!Array.isArray(links)) {
    links = [links]
  }

  const resp = await linkColl.insertMany(
    links.map((link) => ({
      link: link,
      visited: false,
      isExtention: link.slice(-5).includes("."),
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

  if (record && record.link.slice(-5).includes(".")) {
    console.log(`probably an extention ${link}, skipping`)
    await updateLink(link, { isExtention: true })
    return
  }

  console.log(`fetching ${link}`)
  let resp
  try {
    resp = await getLink(link)
  } catch (e) {
    console.log("this link is causing trouble", link)
    await updateLink(link, { isExtention: true })
    return
  }
  if (resp.status !== 200) throw "oops"

  let soup
  try {
    soup = new JSSoup.default(resp.data)
  } catch (e) {
    console.log(`${link} caused an issue`)
    await updateLink(link, { isExtention: true })
    return
  }

  const linkTags = soup.findAll("a")

  const links = _.uniq(
    linkTags
      .map((anchor) => {
        if (!anchor.attrs.href) {
          return null
        }
        return new URL(anchor.attrs.href, link).href.split("?")[0]
      })
      .filter((link) => link && link.includes(root))
  )

  let existingLinks = await linkColl
    .find({ link: { $in: links } })
    .project({ link: 1, _id: 0 })
    .toArray()

  existingLinks = existingLinks.map((rec) => rec.link)

  const diff = _.difference(links, existingLinks)

  if (diff.length) {
    await insertLink(diff)
  }

  // update link we just delved
  await updateLink(link, { visited: true })

  console.log(`finished ${link}`)
}

const root = "https://thetrove.is/Books/"
const scrape = async () => {
  await delve(root)

  const moreToDo = async () => {
    const count = await linkColl
      .find({
        visited: false,
        isExtention: { $in: [null, false] },
      })
      .count()
    return count
  }

  while (await moreToDo()) {
    let pack = await linkColl
      .find({
        visited: false,
        isExtention: { $in: [null, false] },
      })
      .project({ link: 1, _id: 0 })
      .limit(10)
      .toArray()

    pack = pack.map((rec) => delve(rec.link))

    await Promise.all(pack)
  }
}

const massage = async (rec) => {
  console.log("derp", rec.link)

  let path
  try {
    path = decodeURIComponent(rec.link).replace(root, "").trim()
  } catch (e) {
    console.log("oops", e)
    return
  }

  const dir = _path.dirname(path)

  const filename = _path.basename(path)
  await linkColl.updateOne(
    { link: rec.link },
    { $set: { visited: false, path, dir, filename } }
  )
}

const sift = async () => {
  while (true) {
    let pack = await linkColl
      .find({
        isExtention: true,
        path: null,
        filename: null,
        dir: null,
      })
      .limit(20)
      .toArray()

    if (!pack.length) {
      console.log("done!")
      break
    }

    pack = pack.map(massage)

    await Promise.all(pack)
  }
}

//await sift()
// await scrape()

const main = async () => {
  let recs = await linkColl.distinct("dir", {
    path: { $exists: 1 },
  })

  console.log(recs.filter((rec) => !rec.includes("/")))
}

await main()
