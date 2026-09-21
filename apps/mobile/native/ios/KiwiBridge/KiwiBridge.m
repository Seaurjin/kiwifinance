//
//  KiwiBridge.m
//  The method table React Native reads. The implementation is in Swift.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(KiwiBridge, NSObject)

RCT_EXTERN_METHOD(setConfig:(NSString *)baseURL
                  ledgerId:(NSString *)ledgerId
                  accountId:(NSString *)accountId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(writeSnapshot:(NSDictionary *)snapshot
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pendingCaptures:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removePendingCapture:(NSString *)identifier
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
