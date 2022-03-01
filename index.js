const { ApolloServer, UserInputError, gql, AuthenticationError } = require('apollo-server')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

const JWT_SECRET = 'NEED_HERE_A_SECRET_KEY'

const { PubSub } = require('graphql-subscriptions')
const pubsub = new PubSub()

const MONGODB_URI = 'mongodb+srv://fullstack:maylaconcho@fso.eov2l.mongodb.net/grpahql?retryWrites=true&w=majority'

console.log('connecting to MongoDB:', MONGODB_URI)
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('connected to MongoDB')
})
.catch((error) => {
  console.log('error connecting to MongoDB:', error.message)
})

mongoose.set('debug', true)

const uuid = require('uuid/v1')
const Person = require('./model/Person')
const User = require('./model/User')

// let persons = [
//   {
//     name: "Arto Hellas",
//     phone: "040-123543",
//     street: "Tapiolankatu 5 A",
//     city: "Espoo",
//     // id: "3d594650-3436-11e9-bc57-8b80ba54c431"
//   },
//   {
//     name: "Matti Luukkainen",
//     phone: "040-432342",
//     street: "Malminkaari 10 A",
//     city: "Helsinki",
//     // id: '3d599470-3436-11e9-bc57-8b80ba54c431'
//   },
//   {
//     name: "Venla Ruuska",
//     street: "Nallemäentie 22 C",
//     city: "Helsinki",
//     // id: '3d599471-3436-11e9-bc57-8b80ba54c431'
//   },
// ]

// let newPerson
// persons.forEach(async p => {
//   newPerson = new Person({...p})
//   await newPerson.save()
// })

const typeDefs = gql`
  type Person {
    name: String!
    phone: String
    address: Address!
    friendOf: [User!]!
    id: ID!
  }

  type Address {
    street: String!
    city: String! 
  }

  enum YesNo {
    YES
    NO
  }

  type User {
    username: String!
    friends: [Person!]!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Subscription {
    personAdded: Person!
  }

  type Query {
    personCount: Int!
    allPersons(phone: YesNo): [Person!]!
    findPerson(name: String!): Person
    me: User
    allUsers: [User!]!
  }

  type Mutation {
    addPerson(
      name: String!
      phone: String
      street: String!
      city: String!
    ): Person
    editNumber(
      name: String!
      phone: String!
    ): Person
    createUser(
      username: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
    addAsFriend(
      name: String!
    ): User
  }
  

`

const resolvers = {
  Query: {
    // personCount: () => persons.length,
    personCount: () => Person.collection.countDocuments(),
    allPersons: async (root, args) => {
      // if (!args.phone) {
      //   return persons
      // }

      // const byPhone = (person) =>
      //   args.phone === 'YES' ? person.phone : !person.phone

      // return persons.filter(byPhone)
      console.log('Person.find')
      if (!args.phone) {
        return await Person.find({}).populate('friendOf')
      }
      return await Person.find({ phone: { $exists: args.phone === 'YES'}})
      .populate('friendOf')
    },
    // findPerson: (root, args) =>
    //   persons.find(p => p.name === args.name)
    findPerson: async (root, args) => {
      const person = await Person.findOne({ name: args.name })
      return person
    },
    me: (root, args, context) => {
      return context.currentUser
    },
    allUsers: async () => 
    {
      return await User.find({})
    }
  },
  Person: {
    address: (root) => {
      return { 
        street: root.street,
        city: root.city
      }
    },

    // friendOf: async (root) => {
    //   // return list of users
    //   const friends = await User.find({
    //     friends: {
    //       $in: [root._id]
    //     }
    //   })
    //   console.log('User.find')

    //   return friends
    // }
  },
  Mutation: {
    addPerson: async (root, args, context) => {
      console.log('current user before changes', context.currentUser)
      // if (persons.find(p => p.name === args.name)) {
      //   throw new UserInputError('Name must be unique', {
      //     invalidArgs: args.name,
      //   })
      // }
      // const person = { ...args, id: uuid() }
      // persons = persons.concat(person)
      // return person
      const person = new Person({...args})
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      try {
        await person.save()
        console.log(person)
        currentUser.friends = currentUser.friends.concat(person)
        await currentUser.save()
        console.log('current user after changes')
        console.log(currentUser)
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }

      pubsub.publish('PERSON_ADDED', {
        personAdded: person
      })

      return person
      // input validation with mongoose schema
      // try {
      //   await person.save()
      // } catch (error) {
      //   throw new UserInputError(error.message, {
      //     invalidArgs: args
      //   })
      // }
    },
    editNumber: async (root, args) => {
      // const person = persons.find(p => p.name === args.name)
      // if (!person) {
      //   return null
      // }
  
      // const updatedPerson = { ...person, phone: args.phone }
      // persons = persons.map(p => p.name === args.name ? updatedPerson : p)
      // return updatedPerson
      const person = await Person.findOne({ name: args.name })
      console.log(person)
      person.phone = args.phone
      try {
        console.log('trying to change person"s number to')
        console.log(person)
        await person.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
      return person
    },
    createUser: (root, args) =>  {
      const user = new User({ username: args.username })

      return user.save()
      .catch(error => {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if (!user || args.password !== 'secret') {
        throw new UserInputError('wrong credentials')
      }

      const userForToken = {
        username: user.username,
        id: user._id
      }

      return { value: jwt.sign(userForToken, JWT_SECRET) }
    },
    
    addAsFriend: async (root, args, { currentUser }) => {
      const nonFriendAlready = (person) => !currentUser.friends.map(f => f._id).includes(person._id)

      if (!currentUser) {
        throw new AuthenticationError('not authenticated')
      }

      const person = await Person.findOne({ name: args.name })

      if (nonFriendAlready(person)) {
        currentUser.friends = currentUser.friends.concat(person)
      }

      await currentUser.save()

      return currentUser
    }
  },
  
  Subscription: {
    personAdded: {
      subscribe: () => pubsub.asyncIterator(['PERSON_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ( {req} ) => {
    const auth = req ? req.headers.authorization : null
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET)
      const currentUser = await User.findById(decodedToken.id).populate('friends')
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscriptions ready at ${subscriptionsUrl}`)
})