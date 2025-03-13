import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodejsLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as s3Notification from "aws-cdk-lib/aws-s3-notifications";
import {
  App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { bedrock, pinecone } from "@cdklabs/generative-ai-cdk-constructs";
import { HttpMethod } from "aws-cdk-lib/aws-events";
import { NagSuppressions } from "cdk-nag";

export class BedrockChatbotCdkStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    const uniqueName = id;
    const uniqueNameLower = uniqueName.toLowerCase();

    // Configs
    // Update these values with your own values, for production, please refer these from the secret manager
    const configs = {
      vpcId: "XXX",
      pineconeConnectionString: "XXX",
      pineconeCredentialsSecretArn: "XXX",
      assistantName: "Jarrah",
      assistantPrompt: "You are Jarrah, an intelligent voice assistant designed to help Alan. Your responses are concise and precise. Providing clear and accurate information without unnecessary verbosity. You don't use greeting words or phrases.",
    };

    // VPC
    const vpc = ec2.Vpc.fromLookup(this, "VPC", {
      vpcId: configs.vpcId,
    });

    //
    // https://awslabs.github.io/generative-ai-cdk-constructs/src/cdk-lib/bedrock/
    //

    const guardrail = new bedrock.Guardrail(this, "GuardRail", {
      name: `${uniqueNameLower}-guardrail`,
      description: "Legal ethical guardrails.",
    });

    guardrail.addDeniedTopicFilter(bedrock.Topic.FINANCIAL_ADVICE);
    guardrail.addDeniedTopicFilter(bedrock.Topic.MEDICAL_ADVICE);
    guardrail.addDeniedTopicFilter(bedrock.Topic.INAPPROPRIATE_CONTENT);
    guardrail.addDeniedTopicFilter(bedrock.Topic.POLITICAL_ADVICE);
    guardrail.addDeniedTopicFilter(bedrock.Topic.LEGAL_ADVICE);
    guardrail.addWordFilter("sex");
    guardrail.addManagedWordListFilter(bedrock.ManagedWordFilterType.PROFANITY);
    guardrail.addWordFilterFromFile(
      path.join(__dirname, "../data/bedrock/guardrail/words.csv")
    );
    guardrail.addPIIFilter({
      type: bedrock.PIIType.General.ADDRESS,
      action: bedrock.GuardrailAction.ANONYMIZE,
    });
    // guardrail.addRegexFilter({
    //   name: 'TestRegexFilter',
    //   description: 'This is a test regex filter',
    //   pattern: '/^[A-Z]{2}d{6}$/',
    //   action: bedrock.GuardrailAction.ANONYMIZE,
    // });

    // guardrail.addContextualGroundingFilter({
    //   type: bedrock.ContextualGroundingFilterType.GROUNDING,
    //   threshold: 0.95,
    // });

    // guardrail.addContextualGroundingFilter({
    //   type: bedrock.ContextualGroundingFilterType.RELEVANCE,
    //   threshold: 0.95,
    // });

    // guardrail.addDeniedTopicFilter(
    //   bedrock.Topic.custom({
    //     name: 'Legal_Advice',
    //     definition:
    //       'Offering guidance or suggestions on legal matters, legal actions, interpretation of laws, or legal rights and responsibilities.',
    //     examples: [
    //       'Can I sue someone for this?',
    //       'What are my legal rights in this situation?',
    //       'Is this action against the law?',
    //       'What should I do to file a legal complaint?',
    //       'Can you explain this law to me?',
    //     ],
    //   }),
    // );
    guardrail.createVersion("final");

    const accesslogBucket = new s3.Bucket(this, "AccessLogs", {
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    NagSuppressions.addResourceSuppressions(accesslogBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "There is no need to enable access logging for the AccessLogs bucket.",
      },
    ]);

    // Create S3 Bucket for data source
    const dataBucket = new s3.Bucket(this, "DataSourceBucket", {
      bucketName: `${uniqueNameLower}-data-source`,
      enforceSSL: true,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: accesslogBucket,
      serverAccessLogsPrefix: "accessLogs/",
    });

    new s3deploy.BucketDeployment(this, "DataSourceDeployment", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../data/bedrock/knowledge-base"))],
      destinationBucket: dataBucket,
    });

    const pineconeVectorStore = new pinecone.PineconeVectorStore({
      connectionString: configs.pineconeConnectionString,
      credentialsSecretArn: configs.pineconeCredentialsSecretArn,
      textField: "text",
      metadataField: "metadata",
    });

    const knowledgeBase = new bedrock.VectorKnowledgeBase(
      this,
      "KnowledgeBase",
      {
        vectorStore: pineconeVectorStore,
        embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V1,
        name: `${uniqueNameLower}-knowledge-base`,
        instruction: "This is a knowledge base for the Bedrock service",
      }
    );

    const dataSource = new bedrock.S3DataSource(this, "DataSource", {
      bucket: dataBucket,
      knowledgeBase: knowledgeBase,
      dataSourceName: `${uniqueNameLower}-data-source`,
      chunkingStrategy: bedrock.ChunkingStrategy.FIXED_SIZE,
    });

    const bedrockLog = new logs.LogGroup(this, "BedrockLogGroup", {
      logGroupName: `/Jasnova.ai/bedrock/${uniqueName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_DAY,
    });

    const ingestionLambda = new nodejsLambda.NodejsFunction(
      this,
      "IngestionLambda",
      {
        functionName: `${uniqueNameLower}-ingestion-lambda`,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "./lambda/bedrock/ingestion/index.ts"),
        memorySize: 1024,
        handler: "handler",
        timeout: Duration.minutes(10),
        description: "Bedrock knowledge base data ingestion",
        architecture: lambda.Architecture.ARM_64,
        tracing: lambda.Tracing.DISABLED,
        bundling: {
          minify: true,
          format: nodejsLambda.OutputFormat.CJS,
        },
        environment: {
          DATA_SOURCE_ID: dataSource.dataSourceId,
          KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        },
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        logGroup: bedrockLog,
      }
    );

    // Ingestion Lambdda permission
    ingestionLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:StartIngestionJob",
          "bedrock:AssociateThirdPartyKnowledgeBase",
        ],
        resources: [knowledgeBase.knowledgeBaseArn],
      })
    );

    // S3 event notifications
    dataBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3Notification.LambdaDestination(ingestionLambda)
    );

    dataBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3Notification.LambdaDestination(ingestionLambda)
    );

    // Create the agent
    const agent = new bedrock.Agent(this, "Agent", {
      name: `${uniqueNameLower}-agent`,
      description: "Bedrock agent for this service",
      foundationModel: bedrock.BedrockFoundationModel.AMAZON_NOVA_PRO_V1,
      instruction: configs.assistantPrompt,
      idleSessionTTL: Duration.minutes(30),
      knowledgeBases: [knowledgeBase],
      shouldPrepareAgent: true,
      userInputEnabled: true,
      guardrail,
      memory: bedrock.Memory.sessionSummary({
      maxRecentSessions: 10, // Keep the last 20 session summaries
      memoryDurationDays: 20, // Retain summaries for 30 days
      }),
    });

    const agentAlias = new bedrock.AgentAlias(this, "AgentAlias", {
      aliasName: `AgentAlias-${Date.now()}`,
      agent,
      description: `${uniqueNameLower} agent alias`,
    });

    agentAlias.node.addDependency(agent);

    // Replace all hyphens in the name
    const actionGroupName = `${uniqueNameLower}-action-group`.replaceAll(
      /-/g,
      ""
    );

    // Create the lambda for the agent
    const sendSmsLambda = new nodejsLambda.NodejsFunction(
      this,
      "SendSmsLambda",
      {
        functionName: `${uniqueNameLower}-send-sms-lambda`,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "./lambda/bedrock/agent/send-sms.ts"),
        memorySize: 1024,
        handler: "handler",
        timeout: Duration.minutes(5),
        description: `Agent lambda for the ${uniqueName} service`,
        architecture: lambda.Architecture.ARM_64,
        tracing: lambda.Tracing.ACTIVE,
        bundling: {
          minify: true,
          format: nodejsLambda.OutputFormat.CJS,
        },
        environment: {
          ACTION_GROUP_NAME: actionGroupName,
        },
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        logGroup: bedrockLog,
      }
    );

    sendSmsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeAgent", "bedrock:InvokeModel"],
        resources: ["*"],
      })
    );

    // Action group for the agent

    const actionGroup = new bedrock.AgentActionGroup({
      name: actionGroupName,
      description: `Action group for the ${uniqueName} agent`,
      apiSchema: bedrock.ApiSchema.fromLocalAsset(
        path.join(__dirname, "./schema/bedrock/agent.json")
      ),
      enabled: true,
      executor: bedrock.ActionGroupExecutor.fromlambdaFunction(sendSmsLambda),
    });

    agent.addActionGroup(actionGroup);

    // Query Lambda for invoking the agent
    const queryLambda: nodejsLambda.NodejsFunction =
      new nodejsLambda.NodejsFunction(this, "QueryLambda", {
        functionName: `${uniqueNameLower}-query-lambda`,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "./lambda/bedrock/agent/query.ts"),
        memorySize: 1024,
        handler: "handler",
        timeout: Duration.minutes(10),
        description: "Query lambda for the Bedrock service",
        architecture: lambda.Architecture.ARM_64,
        tracing: lambda.Tracing.ACTIVE,
        bundling: {
          minify: true,
          format: nodejsLambda.OutputFormat.CJS,
        },
        environment: {
          AGENT_ID: agent.agentId,
          AGENT_ALIAS_ID: agentAlias.aliasId,
        },
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        logGroup: bedrockLog,
      });

    // Add a function URL to the Query Lambda
    const queryLambdaUrl = queryLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [HttpMethod.POST],
        allowedHeaders: ["Content-Type"],
      },
    });

    // Add the required permissions to the Query Lambda's role
    queryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:RetrieveAndGenerate",
          "bedrock:Retrieve",
          "bedrock:InvokeModel",
          "bedrock:InvokeAgent",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: ["*"],
      })
    );
    queryLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [sendSmsLambda.functionArn],
      })
    );

    // Outputs
    new CfnOutput(this, "DataSourceId", {
      value: dataSource.dataSourceId,
    });

    new CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.knowledgeBaseId,
    });

    new CfnOutput(this, "AgentId", {
      value: agent.agentId,
    });

    new CfnOutput(this, "AgentAliasId", {
      value: agentAlias.aliasId,
    });

    new CfnOutput(this, "FunctionUrl", {
      value: queryLambdaUrl.url,
    });

    NagSuppressions.addResourceSuppressions(
      sendSmsLambda,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "ActionGroup Lambda uses the AWSLambdaBasicExecutionRole AWS Managed Policy.",
        },
      ],
      true
    );
  }
}
