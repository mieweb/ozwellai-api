import { z } from 'zod';
export declare const TextContentPartSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>;
export declare const ImageContentPartSchema: z.ZodObject<{
    type: z.ZodLiteral<"image_url">;
    image_url: z.ZodObject<{
        url: z.ZodString;
        detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}>;
export declare const FileContentPartSchema: z.ZodObject<{
    type: z.ZodLiteral<"file">;
    file: z.ZodObject<{
        file_data: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        file_data: string;
        filename?: string | undefined;
    }, {
        file_data: string;
        filename?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}>;
export declare const ContentPartSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"image_url">;
    image_url: z.ZodObject<{
        url: z.ZodString;
        detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"file">;
    file: z.ZodObject<{
        file_data: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        file_data: string;
        filename?: string | undefined;
    }, {
        file_data: string;
        filename?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}>]>;
export declare const MessageContentSchema: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"image_url">;
    image_url: z.ZodObject<{
        url: z.ZodString;
        detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }, {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}, {
    type: "image_url";
    image_url: {
        url: string;
        detail?: "auto" | "low" | "high" | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"file">;
    file: z.ZodObject<{
        file_data: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        file_data: string;
        filename?: string | undefined;
    }, {
        file_data: string;
        filename?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}, {
    type: "file";
    file: {
        file_data: string;
        filename?: string | undefined;
    };
}>]>, "many">]>;
export declare const MessageSchema: z.ZodObject<{
    role: z.ZodEnum<["system", "user", "assistant", "function", "tool"]>;
    content: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image_url">;
        image_url: z.ZodObject<{
            url: z.ZodString;
            detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        }, {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    }, {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    }>, z.ZodObject<{
        type: z.ZodLiteral<"file">;
        file: z.ZodObject<{
            file_data: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            file_data: string;
            filename?: string | undefined;
        }, {
            file_data: string;
            filename?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "file";
        file: {
            file_data: string;
            filename?: string | undefined;
        };
    }, {
        type: "file";
        file: {
            file_data: string;
            filename?: string | undefined;
        };
    }>]>, "many">]>>;
    name: z.ZodOptional<z.ZodString>;
    function_call: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        arguments: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        arguments: string;
    }, {
        name: string;
        arguments: string;
    }>>;
    tool_calls: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodLiteral<"function">;
        function: z.ZodObject<{
            name: z.ZodString;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            arguments: string;
        }, {
            name: string;
            arguments: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }, {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }>, "many">>;
    tool_call_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    role: "function" | "system" | "user" | "assistant" | "tool";
    content: string | ({
        type: "text";
        text: string;
    } | {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    } | {
        type: "file";
        file: {
            file_data: string;
            filename?: string | undefined;
        };
    })[] | null;
    name?: string | undefined;
    function_call?: {
        name: string;
        arguments: string;
    } | undefined;
    tool_calls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
    tool_call_id?: string | undefined;
}, {
    role: "function" | "system" | "user" | "assistant" | "tool";
    content: string | ({
        type: "text";
        text: string;
    } | {
        type: "image_url";
        image_url: {
            url: string;
            detail?: "auto" | "low" | "high" | undefined;
        };
    } | {
        type: "file";
        file: {
            file_data: string;
            filename?: string | undefined;
        };
    })[] | null;
    name?: string | undefined;
    function_call?: {
        name: string;
        arguments: string;
    } | undefined;
    tool_calls?: {
        function: {
            name: string;
            arguments: string;
        };
        type: "function";
        id: string;
    }[] | undefined;
    tool_call_id?: string | undefined;
}>;
export declare const ModelSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodLiteral<"model">;
    created: z.ZodNumber;
    owned_by: z.ZodString;
}, "strip", z.ZodTypeAny, {
    object: "model";
    id: string;
    created: number;
    owned_by: string;
}, {
    object: "model";
    id: string;
    created: number;
    owned_by: string;
}>;
export declare const ErrorSchema: z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodString;
        param: z.ZodNullable<z.ZodString>;
        code: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    }, {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    };
}, {
    error: {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    };
}>;
export declare const ResponseFormatSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
}, "strip", z.ZodTypeAny, {
    type: "text";
}, {
    type: "text";
}>, z.ZodObject<{
    type: z.ZodLiteral<"json_object">;
}, "strip", z.ZodTypeAny, {
    type: "json_object";
}, {
    type: "json_object";
}>, z.ZodObject<{
    type: z.ZodLiteral<"json_schema">;
    json_schema: z.ZodObject<{
        name: z.ZodString;
        strict: z.ZodOptional<z.ZodBoolean>;
        schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean | undefined;
    }, {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "json_schema";
    json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean | undefined;
    };
}, {
    type: "json_schema";
    json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean | undefined;
    };
}>]>;
export declare const ChatCompletionRequestSchema: z.ZodObject<{
    model: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant", "function", "tool"]>;
        content: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image_url">;
            image_url: z.ZodObject<{
                url: z.ZodString;
                detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
            }, "strip", z.ZodTypeAny, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"file">;
            file: z.ZodObject<{
                file_data: z.ZodString;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                file_data: string;
                filename?: string | undefined;
            }, {
                file_data: string;
                filename?: string | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        }, {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        }>]>, "many">]>>;
        name: z.ZodOptional<z.ZodString>;
        function_call: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            arguments: string;
        }, {
            name: string;
            arguments: string;
        }>>;
        tool_calls: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"function">;
            function: z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }>, "many">>;
        tool_call_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }, {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }>, "many">;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    n: z.ZodOptional<z.ZodNumber>;
    stream: z.ZodOptional<z.ZodBoolean>;
    stop: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    presence_penalty: z.ZodOptional<z.ZodNumber>;
    frequency_penalty: z.ZodOptional<z.ZodNumber>;
    logit_bias: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    response_format: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
    }, "strip", z.ZodTypeAny, {
        type: "text";
    }, {
        type: "text";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"json_object">;
    }, "strip", z.ZodTypeAny, {
        type: "json_object";
    }, {
        type: "json_object";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"json_schema">;
        json_schema: z.ZodObject<{
            name: z.ZodString;
            strict: z.ZodOptional<z.ZodBoolean>;
            schema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        }, {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        type: "json_schema";
        json_schema: {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        };
    }, {
        type: "json_schema";
        json_schema: {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        };
    }>]>>;
    user: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    messages: {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }[];
    user?: string | undefined;
    temperature?: number | undefined;
    top_p?: number | undefined;
    n?: number | undefined;
    stream?: boolean | undefined;
    stop?: string | string[] | undefined;
    max_tokens?: number | undefined;
    presence_penalty?: number | undefined;
    frequency_penalty?: number | undefined;
    logit_bias?: Record<string, number> | undefined;
    response_format?: {
        type: "text";
    } | {
        type: "json_object";
    } | {
        type: "json_schema";
        json_schema: {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        };
    } | undefined;
}, {
    model: string;
    messages: {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }[];
    user?: string | undefined;
    temperature?: number | undefined;
    top_p?: number | undefined;
    n?: number | undefined;
    stream?: boolean | undefined;
    stop?: string | string[] | undefined;
    max_tokens?: number | undefined;
    presence_penalty?: number | undefined;
    frequency_penalty?: number | undefined;
    logit_bias?: Record<string, number> | undefined;
    response_format?: {
        type: "text";
    } | {
        type: "json_object";
    } | {
        type: "json_schema";
        json_schema: {
            name: string;
            schema: Record<string, unknown>;
            strict?: boolean | undefined;
        };
    } | undefined;
}>;
export declare const ChatCompletionChoiceSchema: z.ZodObject<{
    index: z.ZodNumber;
    message: z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant", "function", "tool"]>;
        content: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image_url">;
            image_url: z.ZodObject<{
                url: z.ZodString;
                detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
            }, "strip", z.ZodTypeAny, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }, {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }, {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        }>, z.ZodObject<{
            type: z.ZodLiteral<"file">;
            file: z.ZodObject<{
                file_data: z.ZodString;
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                file_data: string;
                filename?: string | undefined;
            }, {
                file_data: string;
                filename?: string | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        }, {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        }>]>, "many">]>>;
        name: z.ZodOptional<z.ZodString>;
        function_call: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            arguments: string;
        }, {
            name: string;
            arguments: string;
        }>>;
        tool_calls: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodLiteral<"function">;
            function: z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }, {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }>, "many">>;
        tool_call_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }, {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    }>;
    finish_reason: z.ZodNullable<z.ZodEnum<["stop", "length", "function_call", "tool_calls", "content_filter"]>>;
}, "strip", z.ZodTypeAny, {
    message: {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    };
    index: number;
    finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
}, {
    message: {
        role: "function" | "system" | "user" | "assistant" | "tool";
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "image_url";
            image_url: {
                url: string;
                detail?: "auto" | "low" | "high" | undefined;
            };
        } | {
            type: "file";
            file: {
                file_data: string;
                filename?: string | undefined;
            };
        })[] | null;
        name?: string | undefined;
        function_call?: {
            name: string;
            arguments: string;
        } | undefined;
        tool_calls?: {
            function: {
                name: string;
                arguments: string;
            };
            type: "function";
            id: string;
        }[] | undefined;
        tool_call_id?: string | undefined;
    };
    index: number;
    finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
}>;
export declare const ChatCompletionResponseSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodLiteral<"chat.completion">;
    created: z.ZodNumber;
    model: z.ZodString;
    choices: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        message: z.ZodObject<{
            role: z.ZodEnum<["system", "user", "assistant", "function", "tool"]>;
            content: z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image_url">;
                image_url: z.ZodObject<{
                    url: z.ZodString;
                    detail: z.ZodOptional<z.ZodEnum<["auto", "low", "high"]>>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                }, {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            }, {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            }>, z.ZodObject<{
                type: z.ZodLiteral<"file">;
                file: z.ZodObject<{
                    file_data: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    file_data: string;
                    filename?: string | undefined;
                }, {
                    file_data: string;
                    filename?: string | undefined;
                }>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            }, {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            }>]>, "many">]>>;
            name: z.ZodOptional<z.ZodString>;
            function_call: z.ZodOptional<z.ZodObject<{
                name: z.ZodString;
                arguments: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                name: string;
                arguments: string;
            }, {
                name: string;
                arguments: string;
            }>>;
            tool_calls: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                type: z.ZodLiteral<"function">;
                function: z.ZodObject<{
                    name: z.ZodString;
                    arguments: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    name: string;
                    arguments: string;
                }, {
                    name: string;
                    arguments: string;
                }>;
            }, "strip", z.ZodTypeAny, {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }, {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }>, "many">>;
            tool_call_id: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        }, {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        }>;
        finish_reason: z.ZodNullable<z.ZodEnum<["stop", "length", "function_call", "tool_calls", "content_filter"]>>;
    }, "strip", z.ZodTypeAny, {
        message: {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        };
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
    }, {
        message: {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        };
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
    }>, "many">;
    usage: z.ZodObject<{
        prompt_tokens: z.ZodNumber;
        completion_tokens: z.ZodNumber;
        total_tokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }, {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }>;
}, "strip", z.ZodTypeAny, {
    object: "chat.completion";
    id: string;
    model: string;
    created: number;
    choices: {
        message: {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        };
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}, {
    object: "chat.completion";
    id: string;
    model: string;
    created: number;
    choices: {
        message: {
            role: "function" | "system" | "user" | "assistant" | "tool";
            content: string | ({
                type: "text";
                text: string;
            } | {
                type: "image_url";
                image_url: {
                    url: string;
                    detail?: "auto" | "low" | "high" | undefined;
                };
            } | {
                type: "file";
                file: {
                    file_data: string;
                    filename?: string | undefined;
                };
            })[] | null;
            name?: string | undefined;
            function_call?: {
                name: string;
                arguments: string;
            } | undefined;
            tool_calls?: {
                function: {
                    name: string;
                    arguments: string;
                };
                type: "function";
                id: string;
            }[] | undefined;
            tool_call_id?: string | undefined;
        };
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}>;
export declare const ResponseRequestSchema: z.ZodObject<{
    model: z.ZodString;
    input: z.ZodString;
    stream: z.ZodOptional<z.ZodBoolean>;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    model: string;
    input: string;
    temperature?: number | undefined;
    stream?: boolean | undefined;
    max_tokens?: number | undefined;
}, {
    model: string;
    input: string;
    temperature?: number | undefined;
    stream?: boolean | undefined;
    max_tokens?: number | undefined;
}>;
export declare const ResponseSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodLiteral<"response">;
    created: z.ZodNumber;
    model: z.ZodString;
    output: z.ZodString;
    usage: z.ZodObject<{
        input_tokens: z.ZodNumber;
        output_tokens: z.ZodNumber;
        total_tokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
    }, {
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
    }>;
}, "strip", z.ZodTypeAny, {
    object: "response";
    id: string;
    model: string;
    created: number;
    usage: {
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
    };
    output: string;
}, {
    object: "response";
    id: string;
    model: string;
    created: number;
    usage: {
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
    };
    output: string;
}>;
export declare const EmbeddingRequestSchema: z.ZodObject<{
    model: z.ZodString;
    input: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    encoding_format: z.ZodOptional<z.ZodEnum<["float", "base64"]>>;
    dimensions: z.ZodOptional<z.ZodNumber>;
    user: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    input: string | string[];
    user?: string | undefined;
    encoding_format?: "float" | "base64" | undefined;
    dimensions?: number | undefined;
}, {
    model: string;
    input: string | string[];
    user?: string | undefined;
    encoding_format?: "float" | "base64" | undefined;
    dimensions?: number | undefined;
}>;
export declare const EmbeddingSchema: z.ZodObject<{
    object: z.ZodLiteral<"embedding">;
    embedding: z.ZodArray<z.ZodNumber, "many">;
    index: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    object: "embedding";
    index: number;
    embedding: number[];
}, {
    object: "embedding";
    index: number;
    embedding: number[];
}>;
export declare const EmbeddingResponseSchema: z.ZodObject<{
    object: z.ZodLiteral<"list">;
    data: z.ZodArray<z.ZodObject<{
        object: z.ZodLiteral<"embedding">;
        embedding: z.ZodArray<z.ZodNumber, "many">;
        index: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        object: "embedding";
        index: number;
        embedding: number[];
    }, {
        object: "embedding";
        index: number;
        embedding: number[];
    }>, "many">;
    model: z.ZodString;
    usage: z.ZodObject<{
        prompt_tokens: z.ZodNumber;
        total_tokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        prompt_tokens: number;
        total_tokens: number;
    }, {
        prompt_tokens: number;
        total_tokens: number;
    }>;
}, "strip", z.ZodTypeAny, {
    object: "list";
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
    data: {
        object: "embedding";
        index: number;
        embedding: number[];
    }[];
}, {
    object: "list";
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
    data: {
        object: "embedding";
        index: number;
        embedding: number[];
    }[];
}>;
export declare const FileObjectSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodLiteral<"file">;
    bytes: z.ZodNumber;
    created_at: z.ZodNumber;
    filename: z.ZodString;
    purpose: z.ZodString;
}, "strip", z.ZodTypeAny, {
    object: "file";
    filename: string;
    id: string;
    bytes: number;
    created_at: number;
    purpose: string;
}, {
    object: "file";
    filename: string;
    id: string;
    bytes: number;
    created_at: number;
    purpose: string;
}>;
export declare const FileListResponseSchema: z.ZodObject<{
    object: z.ZodLiteral<"list">;
    data: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        object: z.ZodLiteral<"file">;
        bytes: z.ZodNumber;
        created_at: z.ZodNumber;
        filename: z.ZodString;
        purpose: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        object: "file";
        filename: string;
        id: string;
        bytes: number;
        created_at: number;
        purpose: string;
    }, {
        object: "file";
        filename: string;
        id: string;
        bytes: number;
        created_at: number;
        purpose: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    object: "list";
    data: {
        object: "file";
        filename: string;
        id: string;
        bytes: number;
        created_at: number;
        purpose: string;
    }[];
}, {
    object: "list";
    data: {
        object: "file";
        filename: string;
        id: string;
        bytes: number;
        created_at: number;
        purpose: string;
    }[];
}>;
export declare const ModelsListResponseSchema: z.ZodObject<{
    object: z.ZodLiteral<"list">;
    data: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        object: z.ZodLiteral<"model">;
        created: z.ZodNumber;
        owned_by: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        object: "model";
        id: string;
        created: number;
        owned_by: string;
    }, {
        object: "model";
        id: string;
        created: number;
        owned_by: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    object: "list";
    data: {
        object: "model";
        id: string;
        created: number;
        owned_by: string;
    }[];
}, {
    object: "list";
    data: {
        object: "model";
        id: string;
        created: number;
        owned_by: string;
    }[];
}>;
export declare const ChatCompletionChunkSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodLiteral<"chat.completion.chunk">;
    created: z.ZodNumber;
    model: z.ZodString;
    choices: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        delta: z.ZodObject<{
            role: z.ZodOptional<z.ZodString>;
            content: z.ZodOptional<z.ZodString>;
            function_call: z.ZodOptional<z.ZodObject<{
                name: z.ZodOptional<z.ZodString>;
                arguments: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name?: string | undefined;
                arguments?: string | undefined;
            }, {
                name?: string | undefined;
                arguments?: string | undefined;
            }>>;
            tool_calls: z.ZodOptional<z.ZodArray<z.ZodObject<{
                index: z.ZodNumber;
                id: z.ZodOptional<z.ZodString>;
                type: z.ZodOptional<z.ZodLiteral<"function">>;
                function: z.ZodOptional<z.ZodObject<{
                    name: z.ZodOptional<z.ZodString>;
                    arguments: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    name?: string | undefined;
                    arguments?: string | undefined;
                }, {
                    name?: string | undefined;
                    arguments?: string | undefined;
                }>>;
            }, "strip", z.ZodTypeAny, {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }, {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        }, {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        }>;
        finish_reason: z.ZodNullable<z.ZodEnum<["stop", "length", "function_call", "tool_calls", "content_filter"]>>;
    }, "strip", z.ZodTypeAny, {
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
        delta: {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        };
    }, {
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
        delta: {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        };
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    object: "chat.completion.chunk";
    id: string;
    model: string;
    created: number;
    choices: {
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
        delta: {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        };
    }[];
}, {
    object: "chat.completion.chunk";
    id: string;
    model: string;
    created: number;
    choices: {
        index: number;
        finish_reason: "length" | "function_call" | "tool_calls" | "stop" | "content_filter" | null;
        delta: {
            role?: string | undefined;
            content?: string | undefined;
            function_call?: {
                name?: string | undefined;
                arguments?: string | undefined;
            } | undefined;
            tool_calls?: {
                index: number;
                function?: {
                    name?: string | undefined;
                    arguments?: string | undefined;
                } | undefined;
                type?: "function" | undefined;
                id?: string | undefined;
            }[] | undefined;
        };
    }[];
}>;
export type TextContentPart = z.infer<typeof TextContentPartSchema>;
export type ImageContentPart = z.infer<typeof ImageContentPartSchema>;
export type FileContentPart = z.infer<typeof FileContentPartSchema>;
export type ContentPart = z.infer<typeof ContentPartSchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type ResponseRequest = z.infer<typeof ResponseRequestSchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
export type FileObject = z.infer<typeof FileObjectSchema>;
export type FileListResponse = z.infer<typeof FileListResponseSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
export declare const AudioTranscriptionRequestSchema: z.ZodObject<{
    file: z.ZodAny;
    model: z.ZodString;
    response_format: z.ZodOptional<z.ZodEnum<["json", "text", "srt", "verbose_json", "vtt"]>>;
    language: z.ZodOptional<z.ZodString>;
    temperature: z.ZodOptional<z.ZodNumber>;
    timestamp_granularities: z.ZodOptional<z.ZodArray<z.ZodEnum<["word", "segment"]>, "many">>;
}, "strip", z.ZodTypeAny, {
    model: string;
    file?: any;
    temperature?: number | undefined;
    response_format?: "text" | "json" | "srt" | "verbose_json" | "vtt" | undefined;
    language?: string | undefined;
    timestamp_granularities?: ("word" | "segment")[] | undefined;
}, {
    model: string;
    file?: any;
    temperature?: number | undefined;
    response_format?: "text" | "json" | "srt" | "verbose_json" | "vtt" | undefined;
    language?: string | undefined;
    timestamp_granularities?: ("word" | "segment")[] | undefined;
}>;
export declare const TranscriptionWordSchema: z.ZodObject<{
    word: z.ZodString;
    start: z.ZodNumber;
    end: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    word: string;
    start: number;
    end: number;
}, {
    word: string;
    start: number;
    end: number;
}>;
export declare const TranscriptionSegmentSchema: z.ZodObject<{
    id: z.ZodNumber;
    seek: z.ZodOptional<z.ZodNumber>;
    start: z.ZodNumber;
    end: z.ZodNumber;
    text: z.ZodString;
    tokens: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    temperature: z.ZodOptional<z.ZodNumber>;
    avg_logprob: z.ZodOptional<z.ZodNumber>;
    compression_ratio: z.ZodOptional<z.ZodNumber>;
    no_speech_prob: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    text: string;
    id: number;
    start: number;
    end: number;
    temperature?: number | undefined;
    seek?: number | undefined;
    tokens?: number[] | undefined;
    avg_logprob?: number | undefined;
    compression_ratio?: number | undefined;
    no_speech_prob?: number | undefined;
}, {
    text: string;
    id: number;
    start: number;
    end: number;
    temperature?: number | undefined;
    seek?: number | undefined;
    tokens?: number[] | undefined;
    avg_logprob?: number | undefined;
    compression_ratio?: number | undefined;
    no_speech_prob?: number | undefined;
}>;
export declare const AudioTranscriptionResponseSchema: z.ZodObject<{
    task: z.ZodLiteral<"transcribe">;
    language: z.ZodString;
    duration: z.ZodNumber;
    text: z.ZodString;
    words: z.ZodOptional<z.ZodArray<z.ZodObject<{
        word: z.ZodString;
        start: z.ZodNumber;
        end: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        word: string;
        start: number;
        end: number;
    }, {
        word: string;
        start: number;
        end: number;
    }>, "many">>;
    segments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        seek: z.ZodOptional<z.ZodNumber>;
        start: z.ZodNumber;
        end: z.ZodNumber;
        text: z.ZodString;
        tokens: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
        temperature: z.ZodOptional<z.ZodNumber>;
        avg_logprob: z.ZodOptional<z.ZodNumber>;
        compression_ratio: z.ZodOptional<z.ZodNumber>;
        no_speech_prob: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        text: string;
        id: number;
        start: number;
        end: number;
        temperature?: number | undefined;
        seek?: number | undefined;
        tokens?: number[] | undefined;
        avg_logprob?: number | undefined;
        compression_ratio?: number | undefined;
        no_speech_prob?: number | undefined;
    }, {
        text: string;
        id: number;
        start: number;
        end: number;
        temperature?: number | undefined;
        seek?: number | undefined;
        tokens?: number[] | undefined;
        avg_logprob?: number | undefined;
        compression_ratio?: number | undefined;
        no_speech_prob?: number | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    text: string;
    language: string;
    task: "transcribe";
    duration: number;
    words?: {
        word: string;
        start: number;
        end: number;
    }[] | undefined;
    segments?: {
        text: string;
        id: number;
        start: number;
        end: number;
        temperature?: number | undefined;
        seek?: number | undefined;
        tokens?: number[] | undefined;
        avg_logprob?: number | undefined;
        compression_ratio?: number | undefined;
        no_speech_prob?: number | undefined;
    }[] | undefined;
}, {
    text: string;
    language: string;
    task: "transcribe";
    duration: number;
    words?: {
        word: string;
        start: number;
        end: number;
    }[] | undefined;
    segments?: {
        text: string;
        id: number;
        start: number;
        end: number;
        temperature?: number | undefined;
        seek?: number | undefined;
        tokens?: number[] | undefined;
        avg_logprob?: number | undefined;
        compression_ratio?: number | undefined;
        no_speech_prob?: number | undefined;
    }[] | undefined;
}>;
export type AudioTranscriptionRequest = z.infer<typeof AudioTranscriptionRequestSchema>;
export type AudioTranscriptionResponse = z.infer<typeof AudioTranscriptionResponseSchema>;
export declare const AccountIdentitySchema: z.ZodObject<{
    email: z.ZodString;
    user_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    user_id: string;
}, {
    email: string;
    user_id: string;
}>;
export declare const ApiKeyIdentityRequestSchema: z.ZodObject<{
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
export declare const ApiKeyIdentityResponseSchema: z.ZodObject<{
    email: z.ZodString;
    user_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    user_id: string;
}, {
    email: string;
    user_id: string;
}>;
export declare const ApiKeyIdentityErrorSchema: z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodLiteral<"authentication_error">;
        param: z.ZodNull;
        code: z.ZodLiteral<"invalid_key_identity">;
    }, "strip", z.ZodTypeAny, {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    }, {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    };
}, {
    error: {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    };
}>;
export declare const DesktopAuthorizeQuerySchema: z.ZodObject<{
    response_type: z.ZodLiteral<"code">;
    client_id: z.ZodString;
    redirect_uri: z.ZodString;
    state: z.ZodString;
    code_challenge: z.ZodString;
    code_challenge_method: z.ZodLiteral<"S256">;
}, "strip", z.ZodTypeAny, {
    response_type: "code";
    client_id: string;
    redirect_uri: string;
    state: string;
    code_challenge: string;
    code_challenge_method: "S256";
}, {
    response_type: "code";
    client_id: string;
    redirect_uri: string;
    state: string;
    code_challenge: string;
    code_challenge_method: "S256";
}>;
export declare const DesktopAuthorizePageSchema: z.ZodString;
export declare const DesktopCompleteRequestSchema: z.ZodObject<{
    flow_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    flow_id: string;
}, {
    flow_id: string;
}>;
export declare const DesktopCompleteResponseSchema: z.ZodObject<{
    redirect_uri: z.ZodString;
}, "strip", z.ZodTypeAny, {
    redirect_uri: string;
}, {
    redirect_uri: string;
}>;
export declare const DesktopTokenRequestSchema: z.ZodObject<{
    grant_type: z.ZodString;
    client_id: z.ZodString;
    redirect_uri: z.ZodString;
    code: z.ZodString;
    code_verifier: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    client_id: string;
    redirect_uri: string;
    grant_type: string;
    code_verifier: string;
}, {
    code: string;
    client_id: string;
    redirect_uri: string;
    grant_type: string;
    code_verifier: string;
}>;
export declare const DesktopSessionResponseSchema: z.ZodObject<{
    session_token: z.ZodString;
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    session_token: string;
}, {
    email: string;
    session_token: string;
}>;
export declare const DesktopAttestationRequiredResponseSchema: z.ZodObject<{
    attestation_required: z.ZodLiteral<true>;
    login_id: z.ZodString;
    account: z.ZodObject<{
        email: z.ZodString;
        user_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        email: string;
        user_id: string;
    }, {
        email: string;
        user_id: string;
    }>;
}, "strip", z.ZodTypeAny, {
    attestation_required: true;
    login_id: string;
    account: {
        email: string;
        user_id: string;
    };
}, {
    attestation_required: true;
    login_id: string;
    account: {
        email: string;
        user_id: string;
    };
}>;
export declare const DesktopTokenResponseSchema: z.ZodUnion<[z.ZodObject<{
    session_token: z.ZodString;
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    session_token: string;
}, {
    email: string;
    session_token: string;
}>, z.ZodObject<{
    attestation_required: z.ZodLiteral<true>;
    login_id: z.ZodString;
    account: z.ZodObject<{
        email: z.ZodString;
        user_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        email: string;
        user_id: string;
    }, {
        email: string;
        user_id: string;
    }>;
}, "strip", z.ZodTypeAny, {
    attestation_required: true;
    login_id: string;
    account: {
        email: string;
        user_id: string;
    };
}, {
    attestation_required: true;
    login_id: string;
    account: {
        email: string;
        user_id: string;
    };
}>]>;
export declare const DesktopAttestationChallengeRequestSchema: z.ZodObject<{
    login_id: z.ZodString;
    key_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    login_id: string;
    key_id: string;
}, {
    login_id: string;
    key_id: string;
}>;
export declare const DesktopAttestationChallengeResponseSchema: z.ZodObject<{
    challenge: z.ZodString;
    proof_kind: z.ZodEnum<["attestation", "assertion"]>;
}, "strip", z.ZodTypeAny, {
    challenge: string;
    proof_kind: "attestation" | "assertion";
}, {
    challenge: string;
    proof_kind: "attestation" | "assertion";
}>;
export declare const DesktopAttestationVerifyRequestSchema: z.ZodObject<{
    login_id: z.ZodString;
    key_id: z.ZodString;
    proof: z.ZodString;
}, "strip", z.ZodTypeAny, {
    login_id: string;
    key_id: string;
    proof: string;
}, {
    login_id: string;
    key_id: string;
    proof: string;
}>;
export declare const DesktopRequestChallengeRequestSchema: z.ZodObject<{
    method: z.ZodEnum<["GET", "POST"]>;
    path: z.ZodString;
    body_hash: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    method: "GET" | "POST";
    body_hash: string;
}, {
    path: string;
    method: "GET" | "POST";
    body_hash: string;
}>;
export declare const DesktopRequestChallengeResponseSchema: z.ZodObject<{
    challenge_id: z.ZodString;
    challenge: z.ZodString;
}, "strip", z.ZodTypeAny, {
    challenge: string;
    challenge_id: string;
}, {
    challenge: string;
    challenge_id: string;
}>;
export declare const DesktopOAuthErrorSchema: z.ZodObject<{
    error: z.ZodEnum<["invalid_request", "invalid_grant", "invalid_token", "temporarily_unavailable"]>;
    error_description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}>;
export declare const DesktopProofErrorSchema: z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodLiteral<"authentication_error">;
        code: z.ZodLiteral<"invalid_desktop_proof">;
    }, "strip", z.ZodTypeAny, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}>;
export declare const HttpValidationErrorSchema: z.ZodObject<{
    statusCode: z.ZodNumber;
    code: z.ZodOptional<z.ZodString>;
    error: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    error: string;
    statusCode: number;
    code?: string | undefined;
}, {
    message: string;
    error: string;
    statusCode: number;
    code?: string | undefined;
}>;
export declare const AuthenticationBadRequestSchema: z.ZodUnion<[z.ZodObject<{
    error: z.ZodEnum<["invalid_request", "invalid_grant", "invalid_token", "temporarily_unavailable"]>;
    error_description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}>, z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodString;
        param: z.ZodNullable<z.ZodString>;
        code: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    }, {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    };
}, {
    error: {
        type: string;
        code: string | null;
        message: string;
        param: string | null;
    };
}>, z.ZodObject<{
    statusCode: z.ZodNumber;
    code: z.ZodOptional<z.ZodString>;
    error: z.ZodString;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    error: string;
    statusCode: number;
    code?: string | undefined;
}, {
    message: string;
    error: string;
    statusCode: number;
    code?: string | undefined;
}>]>;
export declare const DesktopUnauthorizedResponseSchema: z.ZodUnion<[z.ZodObject<{
    error: z.ZodEnum<["invalid_request", "invalid_grant", "invalid_token", "temporarily_unavailable"]>;
    error_description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}, {
    error: "invalid_request" | "invalid_grant" | "invalid_token" | "temporarily_unavailable";
    error_description: string;
}>, z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodLiteral<"authentication_error">;
        code: z.ZodLiteral<"invalid_desktop_proof">;
    }, "strip", z.ZodTypeAny, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}>]>;
export declare const ApiKeyIdentityUnauthorizedResponseSchema: z.ZodUnion<[z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodLiteral<"authentication_error">;
        param: z.ZodNull;
        code: z.ZodLiteral<"invalid_key_identity">;
    }, "strip", z.ZodTypeAny, {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    }, {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    };
}, {
    error: {
        type: "authentication_error";
        code: "invalid_key_identity";
        message: string;
        param: null;
    };
}>, z.ZodObject<{
    error: z.ZodObject<{
        message: z.ZodString;
        type: z.ZodLiteral<"authentication_error">;
        code: z.ZodLiteral<"invalid_desktop_proof">;
    }, "strip", z.ZodTypeAny, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }, {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}, {
    error: {
        type: "authentication_error";
        code: "invalid_desktop_proof";
        message: string;
    };
}>]>;
export type AccountIdentity = z.infer<typeof AccountIdentitySchema>;
export type ApiKeyIdentityRequest = z.infer<typeof ApiKeyIdentityRequestSchema>;
export type ApiKeyIdentityResponse = z.infer<typeof ApiKeyIdentityResponseSchema>;
export type DesktopAuthorizeQuery = z.infer<typeof DesktopAuthorizeQuerySchema>;
export type DesktopCompleteRequest = z.infer<typeof DesktopCompleteRequestSchema>;
export type DesktopCompleteResponse = z.infer<typeof DesktopCompleteResponseSchema>;
export type DesktopTokenRequest = z.infer<typeof DesktopTokenRequestSchema>;
export type DesktopTokenResponse = z.infer<typeof DesktopTokenResponseSchema>;
export type DesktopSessionResponse = z.infer<typeof DesktopSessionResponseSchema>;
export type DesktopAttestationChallengeRequest = z.infer<typeof DesktopAttestationChallengeRequestSchema>;
export type DesktopAttestationChallengeResponse = z.infer<typeof DesktopAttestationChallengeResponseSchema>;
export type DesktopAttestationVerifyRequest = z.infer<typeof DesktopAttestationVerifyRequestSchema>;
export type DesktopRequestChallengeRequest = z.infer<typeof DesktopRequestChallengeRequestSchema>;
export type DesktopRequestChallengeResponse = z.infer<typeof DesktopRequestChallengeResponseSchema>;
export type DesktopOAuthError = z.infer<typeof DesktopOAuthErrorSchema>;
//# sourceMappingURL=index.d.ts.map