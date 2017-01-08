import { NgModule, ModuleWithProviders } from '@angular/core';
import { OpenIdClientService } from './auth-client.service';
import { OpenIdClientConfig } from './config';
import { Storage, StorageBackend, LocalStorageBackend } from './async-storage';

@NgModule()
export class RootOpenIdClientModule { }

export class OpenIdClientModule {
  static withConfig(config: OpenIdClientConfig): ModuleWithProviders {
    return {
      ngModule: RootOpenIdClientModule,
      providers: [
        OpenIdClientService,
        { provide: StorageBackend, useClass: LocalStorageBackend },
        Storage,
        { provide: 'config', useValue: config }
      ]
    };
  }

}
