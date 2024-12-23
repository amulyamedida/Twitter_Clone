const express = require('express')
const app = express()
app.use(express.json())
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')
const dbpath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server is running at http:/localhost:3000/')
    })
  } catch (e) {
    console.log(e.message)
  }
}

initializeDBAndServer()

const getfollowinguserid = async username => {
  const getquery = `
        select following_user_id from follower inner join user on 
        user.user_id=follower.follower_user_id where 
        user.username='${username}';`
  const followingpeople = await db.all(getquery)
  const arrayids = followingpeople.map(each => each.following_user_id)
  return arrayids
}

const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken) {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

const tweetAccessVerification = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getquery = `
    select * from tweet inner join follower on 
    tweet.user_id=follower.following_user_id where 
    tweet.tweet_id='${tweetId}' and follower_user_id=${userId};`
  const tweet = await db.get(getquery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getquery = `
    select * from user where username='${username}';`
  const userdetails = await db.get(getquery)
  if (userdetails !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedpassword = await bcrypt.hash(password, 10)
      const createquery = `
      insert into user(username,password,name,gender) values(
        '${username}','${hashedpassword}','${name}','${gender}');`
      await db.run(createquery)
      response.send('User created successfully')
    }
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getquery = `select * from user where username='${username}';`
  const userdetails = await db.get(getquery)

  if (userdetails !== undefined) {
    const ispassword = await bcrypt.compare(password, userdetails.password)
    if (ispassword) {
      const payload = {username, userId: userdetails.user_id}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const followingpeople = await getfollowinguserid(username)
  const getquery = `
    select username,tweet,date_time as dateTime from user inner join 
    tweet on 
    user.user_id=tweet.user_id where user.user_id in(${followingpeople}) 
    order by date_time desc limit 4;`
  const tweets = await db.all(getquery)
  response.send(tweets)
})

app.get('/user/following/', authentication, async (request, response) => {
  const {username, userId} = request
  const getquery = `select name from follower inner join user on 
    user.user_id=follower.following_user_id where follower_user_id='${userId}';`
  const res = await db.all(getquery)
  response.send(res)
})

app.get('/user/followers/', authentication, async (request, response) => {
  const {username, userId} = request
  const getquery = `select distinct name from follower inner join user on 
    user.user_id=follower.follower_user_id where following_user_id='${userId}';`
  const res = await db.all(getquery)
  response.send(res)
})

app.get(
  '/tweets/:tweetId/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getquery = `select tweet,
    (select count(like_id) from like where tweet_id='${tweetId}') as likes,
    (select count() from reply where tweet_id='${tweetId}') as replies,
    date_time as dateTime from tweet where 
    tweet.tweet_id='${tweetId}';`
    const res = await db.get(getquery)
    response.send(res)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getquery = `
    select username from user inner join like on user.user_id=like.user_id
    where tweet_id='${tweetId}';`
    const linkedone = await db.all(getquery)
    const array = linkedone.map(e => e.username)
    response.send({likes: array})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const {tweetId} = request.params
    const getquery = `select name,reply from user inner join reply on 
    user.user_id=reply.user_id where tweet_id='${tweetId}';`
    const res = await db.all(getquery)
    response.send({replies: res})
  },
)

app.get('/user/tweets/', authentication, async (request, response) => {
  const {userId} = request
  const getquery = `select tweet, 
    count(distinct like_id) as likes,
    count(distinct reply_id) as replies,
    date_time as dateTime from tweet left join reply on 
    tweet.tweet_id=reply.tweet_id left join like on tweet.tweet_id=like.tweet_id
    where tweet.user_id=${userId} group by tweet.tweet_id;`
  const res = await db.all(getquery)
  response.send(res)
})

app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createquery = `
  insert into tweet(tweet,user_id,date_time)  values('${tweet}','${userId}','${dateTime}')`
  await db.run(createquery)
  response.send('Created a Tweet')
})

app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {tweetId} = request.params
  const {userId} = request
  const getquery = `select * from tweet where user_id='${userId}' and tweet_id='${tweetId}';`
  const tweet = await db.get(getquery)
  console.log(tweet)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deletequery = `delete from tweet where tweet_id='${tweetId}';`
    await db.run(deletequery)
    response.send('Tweet Removed')
  }
})

module.exports = app
