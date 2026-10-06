/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/meridian.json`.
 */
export type Meridian = {
  "address": "2rnq72LPCH1aAGKvJrFU6YWAy6XCQh2ERofPhuqA7YCG",
  "metadata": {
    "name": "meridian",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Binary stock-outcome markets with an on-chain order book"
  },
  "instructions": [
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "setAdmin",
      "discriminator": [
        251,
        163,
        0,
        52,
        91,
        194,
        187,
        92
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "createStrikeMarket",
      "discriminator": [
        21,
        162,
        50,
        119,
        68,
        218,
        221,
        35
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "book",
          "writable": true
        },
        {
          "name": "bookUsdc",
          "writable": true
        },
        {
          "name": "bookYes",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ticker",
          "type": "u8"
        },
        {
          "name": "strike",
          "type": "u64"
        },
        {
          "name": "closeTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "addStrike",
      "discriminator": [
        226,
        190,
        94,
        4,
        5,
        106,
        15,
        120
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "book",
          "writable": true
        },
        {
          "name": "bookUsdc",
          "writable": true
        },
        {
          "name": "bookYes",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ticker",
          "type": "u8"
        },
        {
          "name": "strike",
          "type": "u64"
        },
        {
          "name": "closeTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "mintPair",
      "discriminator": [
        19,
        149,
        94,
        110,
        181,
        186,
        33,
        107
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "qty",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeemPair",
      "discriminator": [
        157,
        102,
        125,
        192,
        31,
        48,
        165,
        114
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "qty",
          "type": "u64"
        }
      ]
    },
    {
      "name": "redeem",
      "discriminator": [
        184,
        12,
        86,
        149,
        70,
        196,
        97,
        225
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "userNo",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market"
        },
        {
          "name": "book",
          "writable": true
        },
        {
          "name": "bookUsdc",
          "writable": true
        },
        {
          "name": "bookYes",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "price",
          "type": "u8"
        },
        {
          "name": "qty",
          "type": "u64"
        },
        {
          "name": "orderType",
          "type": {
            "defined": {
              "name": "orderType"
            }
          }
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market"
        },
        {
          "name": "book",
          "writable": true
        },
        {
          "name": "bookUsdc",
          "writable": true
        },
        {
          "name": "bookYes",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "seq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimFills",
      "discriminator": [
        167,
        244,
        211,
        249,
        74,
        110,
        41,
        32
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market"
        },
        {
          "name": "book",
          "writable": true
        },
        {
          "name": "bookUsdc",
          "writable": true
        },
        {
          "name": "bookYes",
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "userYes",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "settleMarket",
      "discriminator": [
        193,
        153,
        95,
        216,
        166,
        6,
        144,
        217
      ],
      "accounts": [
        {
          "name": "config"
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "priceUpdate"
        }
      ],
      "args": []
    },
    {
      "name": "adminSettle",
      "discriminator": [
        138,
        218,
        221,
        118,
        96,
        220,
        75,
        11
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "config"
        },
        {
          "name": "market",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "orderBook",
      "discriminator": [
        55,
        230,
        125,
        218,
        149,
        39,
        65,
        248
      ]
    }
  ],
  "events": [
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "pairsMinted",
      "discriminator": [
        108,
        154,
        184,
        215,
        50,
        138,
        35,
        141
      ]
    },
    {
      "name": "pairsRedeemed",
      "discriminator": [
        189,
        10,
        115,
        94,
        192,
        143,
        50,
        220
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "fill",
      "discriminator": [
        78,
        225,
        199,
        154,
        86,
        219,
        224,
        169
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "fillsClaimed",
      "discriminator": [
        74,
        239,
        31,
        211,
        134,
        115,
        4,
        132
      ]
    },
    {
      "name": "marketSettled",
      "discriminator": [
        237,
        212,
        22,
        175,
        201,
        117,
        215,
        99
      ]
    },
    {
      "name": "redeemed",
      "discriminator": [
        14,
        29,
        183,
        71,
        31,
        165,
        107,
        38
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer is not the admin"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6002,
      "name": "invalidTicker",
      "msg": "Invalid ticker index"
    },
    {
      "code": 6003,
      "name": "invalidStrike",
      "msg": "Invalid strike"
    },
    {
      "code": 6004,
      "name": "closeInPast",
      "msg": "Close time must be in the future"
    },
    {
      "code": 6005,
      "name": "invalidConfig",
      "msg": "Invalid config parameter"
    },
    {
      "code": 6006,
      "name": "marketClosed",
      "msg": "Market is closed for trading and minting"
    },
    {
      "code": 6007,
      "name": "alreadySettled",
      "msg": "Market already settled"
    },
    {
      "code": 6008,
      "name": "notSettled",
      "msg": "Market not settled yet"
    },
    {
      "code": 6009,
      "name": "tooEarlyToSettle",
      "msg": "Too early to settle: market has not closed"
    },
    {
      "code": 6010,
      "name": "overrideTooEarly",
      "msg": "Admin override not allowed yet: delay after close has not elapsed"
    },
    {
      "code": 6011,
      "name": "zeroQuantity",
      "msg": "Quantity must be positive"
    },
    {
      "code": 6012,
      "name": "invalidPrice",
      "msg": "Price must be between 1 and 99 cents"
    },
    {
      "code": 6013,
      "name": "bookFull",
      "msg": "Order book is full"
    },
    {
      "code": 6014,
      "name": "fillOrKillNotFilled",
      "msg": "Fill-or-kill order could not be fully filled"
    },
    {
      "code": 6015,
      "name": "orderNotFound",
      "msg": "Order not found"
    },
    {
      "code": 6016,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6018,
      "name": "oracleWrongOwner",
      "msg": "Oracle account is not owned by the Pyth receiver"
    },
    {
      "code": 6019,
      "name": "oracleBadAccount",
      "msg": "Oracle account is not a PriceUpdateV2"
    },
    {
      "code": 6020,
      "name": "oracleNotFullyVerified",
      "msg": "Oracle update is only partially verified"
    },
    {
      "code": 6021,
      "name": "oracleWrongFeed",
      "msg": "Oracle feed id does not match this market's ticker"
    },
    {
      "code": 6022,
      "name": "oracleStale",
      "msg": "Oracle price is too far from the market close time"
    },
    {
      "code": 6023,
      "name": "oracleConfidenceTooWide",
      "msg": "Oracle confidence interval is too wide"
    },
    {
      "code": 6024,
      "name": "oracleBadPrice",
      "msg": "Oracle price is not positive"
    },
    {
      "code": 6025,
      "name": "invariantViolated",
      "msg": "Collateral invariant violated"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "maxStalenessSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "overrideDelaySecs",
            "type": "u32"
          },
          {
            "name": "tickers",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    8
                  ]
                },
                7
              ]
            }
          },
          {
            "name": "feedIds",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                7
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxStalenessSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "overrideDelaySecs",
            "type": "u32"
          },
          {
            "name": "tickers",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    8
                  ]
                },
                7
              ]
            }
          },
          {
            "name": "feedIds",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticker",
            "type": "u8"
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "settlePrice",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "settledByOverride",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "yesMint",
            "type": "pubkey"
          },
          {
            "name": "noMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "book",
            "type": "pubkey"
          },
          {
            "name": "bookUsdc",
            "type": "pubkey"
          },
          {
            "name": "bookYes",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "outcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "yesWon"
          },
          {
            "name": "noWon"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "bid"
          },
          {
            "name": "ask"
          }
        ]
      }
    },
    {
      "name": "orderType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "limit"
          },
          {
            "name": "immediateOrCancel"
          },
          {
            "name": "fillOrKill"
          }
        ]
      }
    },
    {
      "name": "order",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "qty",
            "type": "u64"
          },
          {
            "name": "claimable",
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u8"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderBook",
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "nextSeq",
            "type": "u64"
          },
          {
            "name": "orders",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "order"
                  }
                },
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": "u8"
          },
          {
            "name": "strike",
            "type": "u64"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "intraday",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pairsMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pairsRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u8"
          },
          {
            "name": "qty",
            "type": "u64"
          },
          {
            "name": "filled",
            "type": "u64"
          },
          {
            "name": "rested",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fill",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "makerSeq",
            "type": "u64"
          },
          {
            "name": "takerSide",
            "type": "u8"
          },
          {
            "name": "price",
            "type": "u8"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "fillsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "usdc",
            "type": "u64"
          },
          {
            "name": "yes",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "byOverride",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "redeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "yesBurned",
            "type": "u64"
          },
          {
            "name": "noBurned",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
