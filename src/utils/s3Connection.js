import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import config from '../config/config.js';

// Configure AWS S3 Client (v3)
const s3Config = new S3Client({
    region: config.aws.region,
    credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
    },
});

/**
 * Test S3 connection by attempting to list buckets
 * @returns {Promise<boolean>} - Returns true if connection is successful
 */
const testS3Connection = async () => {
    try {
        // Test connection by listing buckets
        const command = new ListBucketsCommand({});
        await s3Config.send(command);
        console.log('✅ AWS S3 connection successful');
        return true;
    } catch (error) {
        console.error('❌ AWS S3 connection failed:', error.message);
        return false;
    }
};

export {
    s3Config as s3,
    testS3Connection
};
export { S3Client }; 