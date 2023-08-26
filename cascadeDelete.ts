/**
 * `resolveNestedObjects` middleware
 */

import { Strapi } from "@strapi/strapi";

interface ContentTypeConfig {
  contentType: string;
  fields: string[] | string;
}

interface Config {
  applyTo: ContentTypeConfig[];
}

export default ({ applyTo }: Config, { strapi }: { strapi: Strapi }) => {
  return async (ctx, next) => {
    const { method, originalUrl } = ctx.request;
    const slashCount = (originalUrl.match(/\//g) || []).length;

    if (method === "DELETE" && originalUrl.includes("/api/")) {
      const split = originalUrl.split("/");
      const parentContentType = split[2].slice(0, -1);
      const getContentTypeConfig = (contentType: string) =>
        applyTo.find((obj) => obj.contentType === contentType);

      const parentContentTypeConfig = getContentTypeConfig(parentContentType);
      if (slashCount === 3 && parentContentTypeConfig) {
        try {
          await strapi.db.transaction(async (transaction) => {
            try {
              const parentId = split[3];
              const parentObj = await strapi
                .service(`api::${parentContentType}.${parentContentType}`)
                .findOne(parentId, { populate: "*" });

              const handleDelete = async (obj, key) => {
                if (Array.isArray(obj[key])) {
                  for (let i = 0; i < obj[key].length; i++) {
                    const nestedObject = obj[key][i];
                    await deleteNestedObjects(nestedObject, key);
                    await strapi
                      .service(`api::${key}.${key}`)
                      .delete(obj[key][i].id);
                  }
                } else {
                  const nestedObject = obj[key];
                  await deleteNestedObjects(nestedObject, key);
                  await strapi
                    .service(`api::${key}.${key}`)
                    .delete(obj[key].id);
                }
              };
              // Recursive function
              const deleteNestedObjects = async (obj, contentType) => {
                const contentTypeConfig = getContentTypeConfig(contentType);
                const fields = contentTypeConfig && contentTypeConfig.fields;

                if (!!fields) {
                  for (const key in obj) {
                    // Check which nested fields should be deleted and delete them
                    if (typeof obj[key] === "object" && obj[key] !== null) {
                      if (fields === "*") {
                        await handleDelete(obj, key);
                      } else if (typeof fields === "string" && fields === key) {
                        await handleDelete(obj, key);
                      } else if (
                        Array.isArray(fields) &&
                        fields.length > 0 &&
                        fields.includes(key)
                      ) {
                        await handleDelete(obj, key);
                      } else {
                        console.log("Malformed config");
                        console.log(key);

                        ctx.status = 500;
                        ctx.body = {
                          data: null,
                          error: {
                            message: "cascadeDelete middleware config error",
                            status: 500,
                            details: "cascadeDelete middleware config error",
                          },
                        };
                      }
                    }
                  }
                }
              };

              await deleteNestedObjects(parentObj, parentContentType);

              await transaction.commit();
              await next();
            } catch (error) {
              console.log(error);

              await transaction.rollback(); // Rollback the transaction if there's an error
              ctx.status = 500;
              ctx.body = { data: null, error };
            }
          });
        } catch (error) {
          // Handle errors and provide a suitable response
          ctx.status = 500;
          ctx.body = "Internal Server Error";
        }
      } else await next();
    } else await next();
  };
};
