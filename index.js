const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT | 3000;

// middlewares
app.use(cors());
app.use(express.json());

const generateJwtToken = ({ fUserId }) => {
  const token = jwt.sign(
    {
      fUserId
    },
    `${process.env.secret}`,
    { expiresIn: "1h" }
  );
  return token;
};

const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res
      .status(403)
      .message({ message: "Authorization token is not provided" });
  }

  //verify token
  jwt.verify(token, process.env.secret, (error, decoded) => {
    if (error) {
      return res.status(401).json({ message: "Invalid token" });
    }
    req.fUserId = decoded.fUserId;
    next();
  });
};

// using SSF News database
const uri = process.env.URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

async function run() {
  try {
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const categoryCollection = client.db("ssfNews").collection("categories");
    const newsCollection = client.db("ssfNews").collection("news");
    const userCollection = client.db("ssfNews").collection("users");

    app.get("/categories", async (req, res) => {
      const query = {};
      const options = {
        sort: {
          categoryId: 1
        }
      };
      const categories = await categoryCollection
        .find(query, options)
        .toArray();
      res.send(categories);
    });

    app.get("/categories/:id", async (req, res) => {
      let id = parseInt(req.params.id);
      let query = { categoryId: id };
      if (!id) {
        id = 0;
        query = {};
      }
      const options = {
        sort: {
          date: -1
        }
      };
      const news = await newsCollection.find(query, options).toArray();
      res.send(news);
    });

    app.get("/search-news/:searchedText", async (req, res) => {
      const { searchedText } = req.params;
      const newsSearchableFields = [
        "userId",
        "userName",
        "categoryId",
        "newsTitle",
        "newsBody"
      ];
      try {
        const searchCriteria = newsSearchableFields.map((field) => ({
          [field]: { $regex: searchedText, $options: "i" }
        }));
        const results = await newsCollection
          .find({
            $or: searchCriteria
          })
          .toArray();
        res.json(results);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    app.get("/news-details/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const news = await newsCollection.findOne(query);
      res.send(news);
    });

    app.get("/news-by-same-author/:id", async (req, res) => {
      const id = req.params.id;
      const query = { userId: id };
      const options = {
        sort: {
          date: -1
        }
      };
      const newsBySameAuthor = await newsCollection
        .find(query, options)
        .toArray();
      res.send(newsBySameAuthor);
    });

    app.post("/post-news", verifyJWT, async (req, res) => {
      const { fUserId, ...news } = req.body;
      if (fUserId !== req.fUserId) {
        return res.status(400).json({ message: "You are not authorised" });
      }
      const result = await newsCollection.insertOne(news);
      res.send(result);
    });

    app.patch("/update-news/:id", async (req, res) => {
      const { fUserId, ...updatedNews } = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          ...updatedNews
        }
      };
      const result = await newsCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      result.categoryId = updatedNews.categoryId;
      res.send(result);
    });

    app.delete("/delete-news/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await newsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const options = {};
      const users = await userCollection.find(query, options).toArray();
      res.send(users);
    });

    //searching with firebase user id;
    app.get("/users/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      if (id !== req.fUserId) {
        return res.status(400).json({ message: "You are not authorised" });
      }
      const query = { fUserId: id };
      const user = await userCollection.findOne(query);
      res.send(user);
    });

    app.post("/users/:mongoId", verifyJWT, async (req, res) => {
      const { mongoId } = req.params;
      const { fUserId } = req.body;
      if (fUserId !== req.fUserId) {
        return res.status(400).json({ message: "You are not authorised" });
      }
      const query = { _id: new ObjectId(mongoId) };
      const user = await userCollection.findOne(query);
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const { fUserId, userEmail } = user;
      const doesAlreadyExist = await userCollection.findOne({ userEmail });
      const token = generateJwtToken({ fUserId });
      if (doesAlreadyExist) {
        return res.send({ message: "User already exists", token });
      }
      const result = await userCollection.insertOne(user);
      result.token = token;
      res.send(result);
    });

    app.get("/user-role/:id", async (req, res) => {
      const id = req.params.id;
      const query = { userId: id };
      const options = {
        projection: { _id: 0, role: 1 }
      };
      const result = await userCollection.findOne(query, options);
      res.send(result);
    });

    app.patch("/update-user-profile/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      if (id !== req.fUserId) {
        return res.status(400).json({ message: "You are not authorised" });
      }
      const updatedProfile = req.body;
      const filter = { fUserId: id };
      const updatedDoc = {
        $set: {
          ...updatedProfile
        }
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/user-role/:id", async (req, res) => {
      const id = req.params.id;
      const role = req.body.newRole;
      const filter = { userId: id };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role
        }
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from current wave");
});

app.listen(port, () => {
  console.log(`Current wave listening on port ${port}`);
});

// Export the Express API
module.exports = app;
