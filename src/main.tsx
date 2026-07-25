import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HashRouter } from "react-router";
import { ApolloProvider } from "@apollo/client/react";
import { apolloClient } from "./graphql/client";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <div id="app-shell">
    {/* <TitleBar /> */}
    <ApolloProvider client={apolloClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </ApolloProvider>
  </div>
);
