import * as cdk from '@aws-cdk/core'
import * as appsync from '@aws-cdk/aws-appsync'
import * as db from '@aws-cdk/aws-dynamodb'
import * as iam from '@aws-cdk/aws-iam'

export class AppsyncCdkStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        const tableName = 'note'

        // make api
        const api = new appsync.CfnGraphQLApi(this, 'api', {
            name: 'cdk-api',
            authenticationType: 'API_KEY'
        })

        // make api key
        new appsync.CfnApiKey(this, 'api-key', {
            apiId: api.attrApiId
        })

        // make schema
        const schema = new appsync.CfnGraphQLSchema(this, 'api-schema', {
            apiId: api.attrApiId,
            definition: `type ${tableName} {
              ${tableName}Id: ID!
              name: String
            }
          
            type Query {
              getOne(${tableName}Id: ID!): ${tableName}
            }
            type Mutation {
              save(name: String!): ${tableName}
              delete(${tableName}Id: ID!): ${tableName}
            }
            type Schema {
              query: Query
              mutation: Mutation
            }`
        })

        // make table
        const table = new db.Table(this, 'cdk-api', {
            tableName: tableName,
            partitionKey: {
                name: `${tableName}Id`,
                type: db.AttributeType.STRING
            },
            billingMode: db.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        })

        // data source
        const itemsTableRole = new iam.Role(this, 'ItemsDynamoDBRole', {
            assumedBy: new iam.ServicePrincipal('appsync.amazonaws.com')
        })

        itemsTableRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                'AmazonDynamoDBFullAccess'
            )
        )

        const tableDataSource = new appsync.CfnDataSource(
            this,
            'tableDatasource',
            {
                apiId: api.attrApiId,
                name: 'ItemsDynamoDataSource',
                type: 'AMAZON_DYNAMODB',
                dynamoDbConfig: {
                    tableName: table.tableName,
                    awsRegion: this.region
                },
                serviceRoleArn: itemsTableRole.roleArn
            }
        )

        // Resolvers
        const getOneResolver = new appsync.CfnResolver(
            this,
            'GetOneQueryResolver',
            {
                apiId: api.attrApiId,
                typeName: 'Query',
                fieldName: 'getOne',
                dataSourceName: tableDataSource.name,
                requestMappingTemplate: `{
                  "version": "2017-02-28",
                  "operation": "GetItem",
                  "key": {
                    "${tableName}Id": $util.dynamodb.toDynamoDBJson($ctx.args.${tableName}Id)
                  }
                }`,
                responseMappingTemplate: `$util.toJson($ctx.result)`
            }
        )
        getOneResolver.addDependsOn(tableDataSource)
        getOneResolver.addDependsOn(schema)

        const saveResolver = new appsync.CfnResolver(
            this,
            'SaveMutationResolver',
            {
                apiId: api.attrApiId,
                typeName: 'Mutation',
                fieldName: 'save',
                dataSourceName: tableDataSource.name,
                requestMappingTemplate: `{
                  "version": "2017-02-28",
                  "operation": "PutItem",
                  "key": {
                    "${tableName}Id": { "S": "$util.autoId()" }
                  },
                  "attributeValues": {
                    "name": $util.dynamodb.toDynamoDBJson($ctx.args.name)
                  }
                }`,
                responseMappingTemplate: `$util.toJson($ctx.result)`
            }
        )
        saveResolver.addDependsOn(tableDataSource)
        saveResolver.addDependsOn(schema)

        const deleteResolver = new appsync.CfnResolver(
            this,
            'DeleteMutationResolver',
            {
                apiId: api.attrApiId,
                typeName: 'Mutation',
                fieldName: 'delete',
                dataSourceName: tableDataSource.name,
                requestMappingTemplate: `{
                  "version": "2017-02-28",
                  "operation": "DeleteItem",
                  "key": {
                    "${tableName}Id": $util.dynamodb.toDynamoDBJson($ctx.args.${tableName}Id)
                  }
                }`,
                responseMappingTemplate: `$util.toJson($ctx.result)`
            }
        )
        deleteResolver.addDependsOn(tableDataSource)
        deleteResolver.addDependsOn(schema)
    }
}

const app = new cdk.App()
new AppsyncCdkStack(app, 'AppsyncCdkStack')
