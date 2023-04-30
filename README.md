# Portfolio APIs

These are APIs for my portfolio website(webapp). The whole webapp is designed to achieve one goal, show my latest projects with little no future maintainance. 

To acheive the goal, Google Firebase Firestore and Functions - similar to AWS's DynamoDB and Lambda. This allows the project to keep running with no server maitainance overhead. 

There are two parts to my portfolio web app. This repository contains code for the backend. For the frontend code visit [folio](https://github.com/avipl/folio)


# Demo

Visit [https://avi-portfolio.net](https://avi-portfolio.net)


# Fetures

- To protect public API, captcha token is verified before processing the request. 
- Allows hosting frontend and backend on different hardware. For faster page loading, backend can be replicated all over the globe in different continents.


## Spam Protection

As this website doesn't require users to authenticate. Obviously, there was no way to protect backend APIs. Hence, I intgrated the [reCaptcha-v3](https://google.com) 

- The API used to fetch the data verifies the captcha information before processing the request.
- The API that responds to GitHub hook, uses a shared secret and [other security measures](https://docs.github.com/en/webhooks-and-events/webhooks/securing-your-webhooks)
