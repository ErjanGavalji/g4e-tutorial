Notes on the [Getting started tutorial](https://docs.glue42.com/g4e/tutorial/index.html)
----
*by Erjan Gavalji, Solutions Engineer, Glue42*

1. [ ] **Reference addition**

Step 1.2: I want to add a reference to the JavaScript and I did not find it.
Possibly mention the SDK folder I have on my desktop and suggest
`npm install  ~/AppData/Local/Tick42/GlueSDK/GlueJS/tick42-glue-major.minor.patch.tgz`
as well as copy the file under
 `~/AppData/Local/Tick42/GlueSDK/GlueJS/js/web/tick42-glue-major.minor.patch.min.js` to the `app` dir (or application root?)

2. [ ] **Unnecessary version explanation**

[Check the Referencing section of the reference](https://docs.glue42.com/g4e/reference/glue/latest/glue/index.html)

See the text 

> Because GLUE for JavaScript evolves, we’ve chosen the following the sematic version model: BreakingChangesVersion.FeatureVersion.FixVersion

This can be omitted by directly referencing the [Semantic Versioning](https://semver.org/) website. This will increase our coolness factor too ;-)

3. [ ] **Confusing instructions**

We are listing the methods to be called in the clients.js. Their existence as commented code is not mentioned. We say

>Now, do the same for portfolio.js, it is pretty much identical apart from the functions you need to call in the .then() statement.

But we never either list the functions, or mention they exist in the file as comments.

4. [ ] **Instructions not clear**

>The application initialized Glue and is deployed (http-server), now you should publish it, so it’s available to your users in the App manger. In this tutorial, we’ll explain, and will work with the file mode configuration.

What will we explain?

5. [ ] **Ignored folder in repo**

The app folder is ignored in the repo. The person following the tutorial however would use this folder and their code would stay there. How would they keep track of their progress?

6. [ ] **Confusing additional information**

The following several lines,

> We have a session dedicated
> ...
> Note: configuration changes are detected in real-time

got me scared that I would not actually get the instructions of how to publish. Present these instructions in a way, noting this is (?important, but ) additional information.

7. [ ] **Confusing structure**

Documentation has the **Glue for Developers** section in the side nav. It also has a top nav, containing Reference section. Can these be organized in a better way? Can we improve the visibility of the top nav, which is the master one?

