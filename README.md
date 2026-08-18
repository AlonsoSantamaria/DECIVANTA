\# DECIVANTA — Autonomous Executive Intelligence



DECIVANTA is an executive intelligence agent built for the \*\*CockroachDB × AWS Hackathon — Build with Agentic Memory\*\*.



DECIVANTA introduces \*\*Sarah\*\*, an Executive Intelligence Agent that uses persistent organizational memory to connect current evidence with prior decisions, assumptions, and follow-up.



> \*\*Memory should not be an archive. Memory should change what the agent does next.\*\*



Sarah follows a recurring executive cycle:



\*\*remember → connect → assess → recommend → record the executive decision → follow up\*\*



The current hackathon demonstration includes three executive missions:



\- \*\*Financial Oversight\*\*

\- \*\*Business Case Watch\*\*

\- \*\*External Intelligence Watch\*\*



\## Live Demo



Judge UI:



https://judge.d2mer8s8oyexv3.amplifyapp.com/



The demonstration uses synthetic organizational data designed specifically for the hackathon.



No credentials are required for the judge-facing demo.



\## Agentic Memory Design



CockroachDB is DECIVANTA's persistent memory layer.



The system stores structured executive state, decisions, follow-up, contextual memory, and embeddings in CockroachDB so that future reviews can be influenced by what happened previously.



DECIVANTA uses:



\### CockroachDB Cloud Managed MCP Server



Managed MCP provides governed access to structured organizational context.



The application uses bounded read operations rather than accepting browser-controlled arbitrary SQL.



\### CockroachDB Distributed Vector Indexing



DECIVANTA stores and retrieves semantic executive memory using CockroachDB vector capabilities.



Amazon Titan Text Embeddings V2 produces normalized 1024-dimensional embeddings used for semantic retrieval.



This allows Sarah to retrieve relevant prior context by meaning rather than relying only on exact identifiers or keywords.



\## AWS Integration



DECIVANTA runs on AWS and uses:



\- \*\*Amazon Bedrock\*\*

&#x20; - Amazon Titan Text Embeddings V2

&#x20; - Amazon Nova Lite

\- \*\*AWS Lambda\*\*

\- \*\*Amazon API Gateway\*\*

\- \*\*AWS Amplify\*\*

\- \*\*AWS Secrets Manager\*\*



Amazon Nova Lite produces bounded executive guidance using retrieved evidence and persistent organizational context.



AWS Lambda executes the backend workflows and orchestration.



Amazon API Gateway exposes the application API.



AWS Amplify hosts the judge-facing web application.



Secrets are stored outside the repository and are not committed to source control.



\## Architecture



At a high level:



```text

Judge / Executive

&#x20;      |

&#x20;      v

DECIVANTA Judge UI

&#x20;  AWS Amplify

&#x20;      |

&#x20;      v

Amazon API Gateway

&#x20;      |

&#x20;      v

&#x20;   AWS Lambda

&#x20;      |

&#x20;      +----------------------+

&#x20;      |                      |

&#x20;      v                      v

&#x20;Amazon Bedrock          CockroachDB

&#x20;Titan Embeddings        Persistent State

&#x20;Nova Lite               Managed MCP

&#x20;                        Vector Index

&#x20;      |                      |

&#x20;      +----------+-----------+

&#x20;                 |

&#x20;                 v

&#x20;     Executive Memory Cycle



retrieve → reason → recommend

&#x20;       → executive action

&#x20;       → persist → follow up

